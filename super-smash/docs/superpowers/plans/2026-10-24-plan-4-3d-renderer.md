# Plan 4 — David-Smash: 3D renderer (SSBU models, retargeted clips, baked bones)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Starts after Plans 1–3 are merged.** Plan 1 (`2026-10-24-plan-1-hosting-online-rename.md`), Plan 2 (`2026-10-24-plan-2-engine-architecture.md`) and Plan 3 (`2026-10-24-plan-3-combat-fidelity.md`) land first, in that order. This plan is written against the code they leave: Plan 2's `BoneTable { readonly fingerprint; pose(fighterId, motion, frame, bone, out): boolean }`, `newBonePose()`, `bakedBoneTable`/`layeredBoneTable`/`LEGACY_BONE_TABLE`, `SimContext.bones`, `src/game/simContext.ts` (`GAME_SIM_CONTEXT`, `engineFingerprint`, `OnlineMatchConfig.bones`), `JumpTiming`/`jumpTimingFor(def)` and `jumpRiseSpeeds`, Plan 2 Task 25's ECB seam (bottom locked at 0, rectangular walls); Plan 3's capsule hitboxes (`Hitbox.x2/y2`, `sweptCapsulePenetration`, glancing blows), `src/fighters/acmd/active.ts` (`activatable`, `withReferenceScripts`, `ACTIVE_SCRIPT_SLOTS` — the root-bone scripts), its new statuses (`tech`, `techRoll`, `techWall`, `techCeiling`, `ledgeTrumped`, with clips chosen in `poseNameFor`), `shieldBubble(f, def)`, `CollisionOutcome.wall` as a side number and `kineticTurnLaunch` (both untouched here), and Plan 3 Task 20/21's engine rules — `ENGINE_RULES_VERSION = 3` (`src/engine/constants.ts`; "every later plan that changes what `step()` does bumps it": this plan sets 4) and `src/game/simContext.ts`'s `EngineRules { version; activeSlots }`, `GAME_ENGINE_RULES`, `engineFingerprint(ctx?, rules?)` hashing the bone table's fingerprint, the version and the active script slots (this plan adds its limb-bone slots there); and Plan 1's `mountMatch`, `MatchRunner.dispose()`, `paint`, NetHud and online start config. Locations are cited by symbol. DECISIONS: Plan 1 D54, Plan 2 D55, Plan 3 D56, this plan **D57**.

**Goal:** Draw David-Smash in 3D with the fighters' real SSBU models (Worldblender's Blender re-exports, fetched and built locally, never committed), animated by the existing 2D pose clips retargeted onto each SSBU skeleton; bake those retargeted bones at build time into integer tables the sim reads, so hitboxes, per-bone hurtboxes and the ECB hang off the limbs the player sees; then switch on the published limb-bone `game_` scripts that only a bake can place.

**Architecture:** The fighters' `.blend` files are fetched at a pinned commit with SHA-256 checks into a git-ignored cache. A stdlib-only Python reader of Blender's file format (no Blender) takes each skeleton's bones, bind matrices and mesh weights from them; the eight trimmed skeletons and their hurt capsules are committed as derived numbers, so the sim, the bake and every test run without Blender or the cache. Blender is needed only to export the glbs (`pnpm models`: Blender headless, the meshes a per-fighter list keeps, joined to one primitive per texture → gltf-transform WebP/meshopt → verify → `public/models/`). Fighters take **SSBU's sizes** (D57): hurtboxes, the ECB and limb reach come from the models' bones. Two consumers: (1) **Build time, committed:** each fighter's trimmed skeleton (bind matrices only) plus our clips, on the fighters as the game plays them (limb-bone scripts on), go through a pure-TS retargeter and forward kinematics into `public/bake/roster.bin.gz` — Q12-on-a-1/256-grid poses per fighter × motion × frame, motion clocks, hurt capsules — fingerprinted by SHA-256. At start-up the game decodes it into `BakeTables` and installs them in Plan 2's `GAME_SIM_CONTEXT` (`bones` for hitboxes; `bake` for clocks and hurtboxes). (2) **Run time:** a three.js presenter draws stage, fighters (GPU-skinned glbs, toon + rim), shields and sparks under the existing 2D canvas, which becomes a transparent overlay for the HUD and every 2D effect; its side camera is framed by `render/camera.ts` so both layers line up exactly. The renderer evaluates the *same* clock → clip sample → retarget → root transform as the bake, so the drawn limb is the baked limb (tested to within the bake's 1/256-unit quantum).

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3 static export, React 19, three.js **0.186.1** (+ `@types/three` 0.186.0; `GLTFLoader`, `MeshoptDecoder`, `SkeletonUtils` from `three/examples/jsm`; loaded as its own chunk after `/play` mounts), Python 3 standard library only (the `.blend` reader, run `python3 -I -B`; nothing to install), vitest 4.1 (jsdom), Playwright 1.62 (Chromium, WebGL through SwiftShader/ANGLE headless), Blender **5.2.2** portable (macOS arm64 DMG, SHA-256 pinned) for the export only, `@gltf-transform/{core,functions,extensions}` **4.5.1**, `meshoptimizer` **1.3.0**, `sharp` **0.35.3** (the version Next 16.3 already installs — a second copy loads two libvips and macOS warns), Node 26 (scripts import `.ts` by type stripping, as Plan 2's `import-acmd.mjs`; `models:fetch` passes `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`), pnpm 11.

**Spec:** docs/superpowers/specs/2026-10-24-david-smash-design.md (§2 why 3D; §3.1 constraints; §3.2 phase 4; §3.4 budget)

**Conventions for every task** (as Plans 1–2)
- `pnpm …` commands run in `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/super-smash`; paths in steps are relative to it.
- `git …` commands run from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates` with paths prefixed `super-smash/`, committing straight to `main`. Never `git add -A`; stage the exact paths listed. **Never stage anything under `super-smash/.model-cache/` or `super-smash/public/models/`, nor any `.blend`/`.glb`/texture** — Task 1's guard test fails if one is ever tracked. Never push without David's go.
- Every commit body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The full gate is `pnpm typecheck && pnpm lint && pnpm test`. e2e gates use `PORT=3107 pnpm test:e2e` (Plan 1's convention, including its single-rerun rule for a cold-start timeout).
- Steps that install software or download ~1 GB are marked **STOP: ask David for go** (Task 7's Blender). Task 5's model download (78.4 MiB into the git-ignored cache, nothing installed) is part of the plan's go.
- Generated artefacts follow Plan 2's `UPDATE_*=1` pattern: a test regenerates them on request and otherwise proves the committed copy is exactly what the code produces. This plan adds `UPDATE_SKELETONS`, `UPDATE_BAKE`, `UPDATE_HURT`, `UPDATE_LIMB`, `UPDATE_REACH`, and reuses `UPDATE_GOLDEN` and `UPDATE_RECONCILE`. Where scratch produced an artefact from the real inputs, the step gives its exact content or SHA-256, so a different result stops the executor instead of being committed.

**Docs and data checked (2026-10-24):**
- Model source: GitLab project `Worldblender/smash-ultimate-models-exported` (id 11666571), last commit `df76879171b064570b4e49a608c9f98211b33edb` (2021-11-01). README: "near-straight imports from the original files" by the author's `SSBUlt_NUMDLB.py` importer, "only basic materials … at least the color texture", LFS files served through `/-/raw/<sha>/<path>` (`mario-c00.blend` = 9,190,080 bytes, `BLENDER-v283`). `cleanup-meshes.py`, which the README mentions, is not in the repository; this plan lists every fighter's meshes, kept or dropped, by name (`scripts/models/meshes.json`).
- c00 folders for our eight codes (`mario donkey link samus kirby fox pikachu marth`) list one `.blend` plus `*_col/_nor/_prm[/_emi].png`; the colour maps and `.blend`s this plan fetches are 114 files, 82,191,933 bytes (Donkey Kong's `eye_donkey_001.png` has no suffix; 17 of the 114 names match no simple texture pattern). The importer (`io_scene_numdlb/SSBUlt_NUMDLB.py`) keeps SSBU bone names, sets each Blender bone's matrix to the SSBU bind matrix, and turns the armature object +90° about X ("Auto-Rotate Armature", default on).
- All eight `.blend` files, parsed read-only in scratch with the committed SDNA reader (no Blender): bones Mario 98, Donkey Kong 117, Link 145, Samus 53, Kirby 51, Fox 79, Pikachu 77, Marth 145; meshes (with Blender's `.001` copies) Mario 62, Donkey Kong 58, Link 55, Samus 25, Kirby 26, Fox 37, Pikachu 40, Marth 47. Mario's: 98 bones from `Trans`; `Rot`→`Hip`→`Waist`→`Bust`→`Neck`→`Head`; `ClavicleC`→`ClavicleL`→`ShoulderL` (upper arm)→`ArmL` (forearm)→`HandL`→`HaveL`; `Hip`→`LegC`→`LegL` (thigh)→`KneeL` (shin)→`FootL`→`ToeL`; limb bones' local +X runs along the limb; armature space is +Y up, +Z forward (ToeL z 1.30 > FootL z −0.07), +X the fighter's left; the armature object's matrix is exactly Rx(+90°). Meshes: `c00bodyShape(.001)` plus expression meshes `Mario_<Token>_VIS_O_OBJShape(.001)` with tokens FaceN, FaceNMClose/Half/Open, Eye, Blink, Halfblink1–3, Attack, Ouch…, Hathead, Nohat, Hair; materials reference `//<name>_col.png` relative paths. 2,664 vertices / 4,124 polygons in the body mesh: the whole roster is far inside the 500k-triangle budget.
- ACMD bone names used by the imported scripts (Plan 2's `src/fighters/acmd/generated/`): `top hip waist bust neck head trans rot throw haver claviclel shoulderl/r arml/r handl/r legr kneel/r footl/r toel/r sword1 sword2 tail1–tail4` — the same bones, lower-cased.
- three.js 0.186.1 (published 2026-09-24): `GLTFLoader.setMeshoptDecoder`, `examples/jsm/libs/meshopt_decoder.module.js` (decoder inlined, nothing to host), `ShaderLib.toon` still has `#include <emissivemap_fragment>`; works with Next 16 as a client-only dynamic import.
- @gltf-transform 4.5.1: `dedup`, `prune` (drops solid-colour textures by default — correct here), `weld`, `textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] })`, `meshopt({ encoder: MeshoptEncoder })`; three decodes `EXT_meshopt_compression` + `KHR_mesh_quantization` + `EXT_texture_webp` natively.
- Blender 5.2.2 macOS arm64: `https://download.blender.org/release/Blender5.2/blender-5.2.2-macos-arm64.dmg`, SHA-256 `dc4125399b8bfefe283cc1624d6cfc7809d1cac20ace51072127eb371f31f210` (from `blender-5.2.2.sha256`), 346,286,611 bytes, published 2026-09-15. Homebrew's cask is 5.2.2 too but installs system-wide into `/Applications`; this plan keeps Blender inside the git-ignored cache.
- rubendal's data viewer JSON (`Articles`, `Scripts`, `Motions`, `Id`, `Name`, `GameName`) publishes no hurtboxes; hurt capsules are therefore derived from mesh weights and marked UNVERIFIED.

**What was verified in scratch before writing** (`/private/tmp/claude-501/-Users-fobrizzlemynizzle-Documents-Personal-Projects/1b5c93cf-4a75-4d9f-92bb-6a571bd2578b/scratchpad/plan4-6258/ws4`: Plan 3's final branch `plan3b` of `plan3-b8e2/ws2` — 21 tasks, Plans 1 Task 15, 2 and 3 applied — with this plan applied on top, private `node_modules`, the real model cache): every code block below that names a file was copied from that tree, where `pnpm typecheck`, `pnpm lint` (two pre-existing warnings in `research/`) and `pnpm test` pass — 132 files, 3,094 tests, 1 skipped (the Blender cross-check, no Blender). The **real** inputs drove it: all eight fighters fetched at the pinned commit (114 files) and read by the committed SDNA reader; the eight committed skeletons, the hurt-size ratchet, the bake (Task 10 and Task 13 digests both given), `limb.json` (53 slots), `reach.allow.json` (27 moves), the reconcile deletions (17) and the golden trace are what those inputs produce, and replaying Tasks 10–13 step by step in a second copy (`…/plan4-6258/ws5`) reproduced every one byte for byte. Each changed task's failing step was run and its message copied. `next build` passed, and with `/play` loading `world3d` by `import()` its initial scripts fell from 520 KB to 356 KB gzipped. In headless Chromium the whole e2e suite passed (19 passed, 7 skipped by design; one cold-start timeout in the resize test on the first run, 8/8 on rerun), the lab photographed Mario's limb-bone forward tilt on his real skeleton, and the screenshot capture ran with SSBU-sized stand-ins and port tags on their heads. **Not verifiable without Blender** (Task 7's STOP): `export_gltf.py` (byte-compiled; its mesh list, materials and hurt capsules follow the reader's, which the Task 8 cross-check proves), the join's draw-call counts in a real browser (the material counts were read from the files: at most 10 per fighter), real glb sizes and triangles. Not run at all: Plan 1's final `play/page.tsx` and online code (Task 20 Steps 7–8 are written by symbol; the logic was verified on the pre-Plan-1 page), and Task 23's deletions beyond the swing-arc removal (written by symbol, with the grep that finds them measured).

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

Plan-4 specifics that follow from them: the committed derived data are only bone *names and numbers* (`src/render3d/skeletons/*.json`, `public/bake/roster.bin.gz`) and SHA-256s (`scripts/models/manifest.json`, `src/fighters/bake/digest.ts`); the engine reads the bake through `BoneTable`/`BakeTables` in integers only; the three.js code lives outside `src/engine/`.

## Review Focus

Five ways a player gets hurt that no feature test in this plan would catch on its own, and the test that owns each:

1. **A fighter's model is missing, 404s, is corrupt or never finishes downloading** (a checkout that never ran `pnpm models`, a deploy without models, a flaky network). The match must still start and play, with that fighter drawn as a stand-in built from its own hurt capsules, and say why in the console — never a blank screen or the error page. Tests: `src/render3d/models/loader.test.ts` "stands a fighter in when the index is missing", "…when its glb is corrupt or 404s…", "gives up on a hung download…", "tries a failed model again next match…" and "refuses a truncated or stale file before the decoder sees it" (Task 16); `src/render3d/renderer3d.test.ts` "paints four stand-in fighters when no models were built" (Task 19); `e2e/render3d.spec.ts` "plays with stand-ins when the models 404" (Task 22).
2. **The WebGL context is lost mid-match** (driver reset, GPU process crash, too many tabs). The sim must keep running, painting must pause rather than throw, and the picture must come back when the browser restores the context. Tests: `renderer3d.test.ts` "stops painting while the WebGL context is lost and resumes when it is restored" (Task 19); `e2e/render3d.spec.ts` "survives WEBGL_lose_context and comes back" (Task 22).
3. **The window is resized or dragged to a display with a different pixel ratio.** The 3D buffer must follow the CSS size × DPR, capped at 1080p, and stay exactly under the 2D overlay (HUD and port tags over the right fighter). Tests: `renderer3d.test.ts` "sizes its buffer to the window and the display's pixel ratio, never past 1080p" (Task 19); `src/render3d/camera3d.test.ts` "puts every point of the sim's plane exactly where the 2D overlay draws it" (Task 14); `e2e/render3d.spec.ts` "follows a resize and a DPR change" (Task 22).
4. **A fighter turns round mid-attack (a reverse aerial, a turnaround into a smash).** The model turns (it is not mirrored, as SSBU), and the hitbox the sim mirrors by facing must still sit on the limb drawn. Tests: `src/render3d/fighter3d.test.ts` "puts a limb where the sim puts its hitbox, facing either way" (Task 17); `src/render3d/fighterPose.test.ts` "the renderer's pose equals the bake" (Task 17).
5. **Four fighters on an Iris Xe-class iGPU at 1080p.** Draw calls must stay under 100 and skinned triangles under 500k with all eight glbs loaded, whatever is on screen (four shields, a KO burst, sparks). The real files are 4–44 meshes each, so the export joins each fighter to one primitive per texture and `glb.mjs` refuses more than 12. Tests: `src/render3d/pipeline/glb.test.ts` "fails one drawn in more" (Task 8); `renderer3d.test.ts` "stays inside the draw-call budget with four real models at the glb.mjs primitive cap" (55 calls) and the stand-in count (Task 19); `e2e/render3d.spec.ts` "stays inside the draw-call and triangle budget with four fighters", run with `REQUIRE_MODELS=1` against the real glbs (Task 22 Step 3).

---

## File Structure

Created:
- `src/render3d/math/rigid.ts` — quaternions and column-major 4×4 rigid maths, no three.js (Task 2).
- `src/render3d/skeleton/skeleton.ts` (+ `skeleton.test.ts`), `testSkeleton.ts` — the committed skeleton format, `buildRig`, `trimSkeleton`, an invented SSBU-shaped test skeleton (Task 2).
- `src/render3d/retarget/map.ts`, `retarget.ts` (+ `retarget.test.ts`) — 2D bone → SSBU bone drives, calibration, `retarget()` (Task 3).
- `src/render3d/bake/fk.ts` (+ `fk.test.ts`) — forward kinematics, `RootXform`, side-plane projection (Tasks 3–4).
- `src/render3d/pipeline/noRippedAssets.test.ts` — no ripped file is ever tracked (Task 1; by manifest name and bytes from Task 5).
- `src/render3d/pipeline/manifest.ts` (+ `.test.ts`), `scripts/models/fetch.mjs`, `scripts/models/manifest.json` — pinned source, fetch with SHA-256 checks (Task 5).
- `scripts/models/skeleton_from_blend.py`, `skeletons.mjs`, `meshes.json`; `src/render3d/pipeline/dump.ts` (+ `dump.test.ts`); `src/render3d/skeletons/{hurtBones.json,hurtBones.ts,index.ts,missing.json,skeletons.test.ts}` and `{mario,donkeyKong,link,samus,kirby,fox,pikachu,marth}.json`; `src/engine/acmd/scriptBones.ts`; `src/render3d/bake/roster.ts` — the skeletons, read without Blender and committed (Task 6).
- `scripts/models/export_gltf.py`, `glb.mjs`, `build.mjs`, `check.mjs`; `src/render3d/budget.ts`; `src/render3d/pipeline/glb.test.ts` — the Blender export, optimise/verify/publish, deploy guard (Task 8).
- `src/engine/acmd/poseClock.ts` (+ `.test.ts`) — status motions, clocks, `poseIndexOf`, `statusDuration` (Task 9).
- `src/engine/acmd/bakeCodec.ts` (+ `.test.ts`), `bakeTables.ts`; `src/render3d/bake/bake.ts`, `roster.test.ts`; `public/bake/roster.bin.gz`; `src/fighters/bake/digest.ts` — the bake (Task 10).
- `src/game/bake.ts` (+ `bake.test.ts`), `bakeNode.ts` — loading and installing the bake (Task 11).
- `src/engine/acmd/hurtboxes.ts`, `src/game/hurtboxes.test.ts`, `src/game/hurt.allow.json`, `src/game/framing.test.ts` — per-bone hurtboxes, the bone ECB, SSBU sizes (Task 12).
- `src/fighters/acmd/limb.ts` (+ `limb.test.ts`), `limb.json`, `reach.test.ts`, `reach.allow.json` — limb-bone scripts switched on (Task 13).
- `src/render3d/camera3d.ts` (+ `.test.ts`) (Task 14); `stage3d.ts` (+ `.test.ts`) (Task 15); `models/loader.ts` (+ `.test.ts`) (Task 16); `threeRig.ts`, `toon.ts` (+ `.test.ts`), `fighterPose.ts` (+ `.test.ts`), `fighter3d.ts` (+ `.test.ts`) (Task 17); `vfx3d.ts` (+ `.test.ts`) (Task 18); `renderer3d.ts` (+ `.test.ts`) (Task 19).
- `src/render3d/anchors.ts` (+ `.test.ts`), `src/render/overlay3d.test.ts`, `src/game/world3d.ts` (+ `.test.ts`), `src/game/useBake.ts`, `src/game/useWorld3d.ts`, `src/game/matchRunner.presenter.test.ts`, `src/app/chunkSplit.test.ts` (Task 20); `src/app/anim/Lab3D.tsx` (Task 21); `e2e/render3d.spec.ts` (Task 22).

Modified:
- `.gitignore` (Task 1); `package.json` (Tasks 5, 6, 8, 14), `pnpm-lock.yaml` (Tasks 8, 14).
- `src/render/poses/timing.ts` — `SLOT_POSE` and `PACED_BY_SPEED` exported, `STRIDE` = `STRIDE_UNITS` (Task 9).
- `src/engine/simulate.ts` — `SimContext.bake` (Task 11); per-bone hurtboxes in `resolveHits` (deepest capsule reached feeds Plan 3's glancing-blow rule) and the bone ECB into `resolveCollision`/`findLedgeGrab` (Task 12). `src/engine/physics.ts` — `CollisionOptions.ecb` (Task 12). `src/engine/constants.ts` — `ENGINE_RULES_VERSION = 4` (Task 12).
- `src/game/simContext.ts` — `GAME_SIM_CONTEXT` mutable for `installBake` (Task 11); `GAME_ENGINE_RULES` mutable, `mergeSlots` (Task 13); `src/game/simContext.test.ts` (Task 12); `src/game/golden.test.ts`, `src/game/__golden__/engine-trace.json` (Tasks 12–13).
- `src/fighters/acmd/active.ts` — `activatable(…, placeable)` (Task 13); `src/fighters/acmd/reconcile.test.ts`, `reconcile.allow.json` (Task 13); `src/render3d/bake/roster.ts`, `roster.test.ts`, `src/game/bake.ts`, `bake.test.ts` (Task 13: the game's fighters baked, the slots in the rules).
- `src/render/stageArt.ts` — `stagePaintFor` (Task 15); `src/render/renderer.ts` — `intangibleAlpha` exported (Task 17), `world3d` overlay mode, `anchors`, `renderBackground`, `OverlayResult`, no 2D swing arcs in 3D (Task 20); `src/render/vfx.ts` — `drawParticles` skip set (Task 20).
- `src/game/matchRunner.ts` — `presenter`, `background`, `WorldPresenter`, anchors, `dispose` frees it (Task 20); `src/app/play/page.tsx` — three stacked canvases, loading, bake + `useWorld3d` (Task 20); `src/app/online/page.tsx`, `src/components/menu/CharacterSelect.tsx`, `src/lib/onlineStore.ts` — bake installed before a start, lobby preload (Task 20); `e2e/helpers.ts` — `waitForMatch` waits on the sim (Task 20).
- `src/app/anim/page.tsx`, `scripts/animsheet.mjs`, `scripts/fightsheet.mjs` (Task 21).
- Removed in Task 23: the Canvas2D full-body fighter path (`drawOneFighter`'s figure, rim and silhouette, `drawAfterimages` and afterimage tracking, `drawPlatforms`, the 2D `drawShield`, `debugSilhouette`, `render/swing.ts`, the lab's 2D cells). Kept: `src/render/poses/**`, `chars/*/{poses,fx}.ts`, `drawFigure` and the rigs (HUD portraits and stock icons), the overlay effects.
- `docs/character-art.md`, `docs/screenshots/match.png`, `match-2.png`, `DECISIONS.md` (D57), `README.md` (Task 23).

Spec coverage: model pipeline → Tasks 1, 5–8 (Blender only in 7–8); retargeting → Tasks 2–4; bone bake → Tasks 9–11; hurtboxes and ECB → Task 12; limb-bone scripts → Task 13; three.js renderer (camera, stage, models, fighters, VFX, presenter, overlay, loading, fallback, dispose) → Tasks 14–20; lab, sheets, e2e, perf → Tasks 21–22; removal of dead 2D paths → Task 23.

---

### Task 1: Keep every Nintendo file out of git, before any is downloaded

**Files:**
- Create: `super-smash/src/render3d/pipeline/noRippedAssets.test.ts`
- Modify: `super-smash/.gitignore`

**Interfaces:**
- Produces: ignore rules `/.model-cache/`, `/public/models/`, `*.blend`, `*.blend1`, `__pycache__/`; a test that fails if anything under `.model-cache/` or `public/models/`, or any file in a format only the model pipeline makes (`.blend`, `.blend1`, `.glb`, `.gltf`, `.webp`, `.ktx2`), is tracked or staged. Task 5 widens it to every file the manifest lists, by name and by bytes (a name pattern missed 17 of the 114 real files).

- [ ] **Step 1: Write the failing test** — `src/render3d/pipeline/noRippedAssets.test.ts`:

```ts
// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The public repo must never hold a ripped model or texture (spec §3.1): a DMCA
 * notice against one would take down every replica in Replicates. The fetched
 * files live in `.model-cache/`, the built glbs in `public/models/`; both are
 * git-ignored, and this test fails if anything there, or any file in a format
 * only the model pipeline makes, is ever tracked or staged. Task 5 extends it
 * to every file the manifest lists, by name and by bytes.
 */

const ROOT = process.cwd();

describe("no Nintendo-ripped asset is tracked", () => {
  it("ignores the model cache, the built models and Python bytecode", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
    for (const rule of ["/.model-cache/", "/public/models/", "*.blend", "__pycache__/"]) expect(ignore).toContain(rule);
    const check = (p: string) => execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: ROOT, stdio: "pipe" });
    expect(() => check(".model-cache/src/mario/mario-c00.blend")).not.toThrow();
    expect(() => check("public/models/mario.0123abcd.glb")).not.toThrow();
    expect(() => check("public/models/index.json")).not.toThrow();
    expect(() => check("scripts/models/__pycache__/x.pyc")).not.toThrow();
  });

  it("tracks and stages nothing from the cache or the built models, and no pipeline-only format", () => {
    const tracked = execFileSync("git", ["ls-files", "--cached", "--", "."], { cwd: ROOT, encoding: "utf8" }).split("\n");
    const bad = tracked.filter(
      (f) => /\.(blend|blend1|glb|gltf|webp|ktx2)$/i.test(f) || f.startsWith(".model-cache/") || f.startsWith("public/models/"),
    );
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/pipeline/noRippedAssets.test.ts`
Expected: FAIL in "ignores the model cache, the built models and Python bytecode" — `AssertionError: expected [ 'node_modules/', '.next/', … ] to include '/.model-cache/'` (the array is today's `.gitignore`, line by line; the rules do not exist yet). The second test passes: nothing ripped is tracked today.

- [ ] **Step 3: Implement** — append to `.gitignore`:

```gitignore

# Nintendo-ripped models and textures (spec §3.1): fetched and built locally by
# `pnpm models`, deployed from local disk, never committed. Only hashes
# (scripts/models/manifest.json) and derived numbers (src/render3d/skeletons/,
# public/bake/) are tracked.
/.model-cache/
/public/models/
*.blend
*.blend1
# Bytecode from the model scripts (they run with -B; this catches a run without it).
__pycache__/
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render3d/pipeline/noRippedAssets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/.gitignore super-smash/src/render3d/pipeline/noRippedAssets.test.ts
git commit -m "super-smash: never track a ripped model or texture" -m "Ignore .model-cache/, public/models/, .blend files and Python bytecode before the model pipeline downloads anything, and fail a test if anything from the cache or the built models, or any pipeline-only format (.blend, .glb, .gltf, .webp, .ktx2), is ever tracked or staged (spec 3.1: a DMCA notice would take down every replica)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rigid maths and the skeleton file format

The bake must be reproducible from a plain `vitest run`, so its maths cannot depend on three.js; the renderer uses three.js and Task 17 proves the two agree. The skeleton format is what the bone dump (read from each `.blend` without Blender, Task 6) is trimmed to and committed. Everything is tested here against an invented skeleton that copies SSBU's *conventions* (verified on Mario's real `.blend`) but none of its numbers.

**Files:**
- Create: `super-smash/src/render3d/math/rigid.ts`, `super-smash/src/render3d/skeleton/skeleton.ts`, `super-smash/src/render3d/skeleton/testSkeleton.ts`, `super-smash/src/render3d/skeleton/skeleton.test.ts`

**Interfaces:**
- Produces (`math/rigid.ts`): `type Quat = readonly [x, y, z, w]`, `type Vec3`, `type Mat4 = readonly number[]` (16, column-major), `IDENTITY_Q`, `qMul`, `qConj`, `qNormalize`, `qAxisAngle`, `qRotX`, `qRotate`, `qFromTo`, `normalize`, `compose(t, q, s?)`, `mMul`, `mInvertRigid`, `mTranslation`, `mAxis(m, 0|1|2)`, `mRotation`.
- Produces (`skeleton/skeleton.ts`): `SKELETON_SCHEMA = 1`, `SkeletonBone { name; parent: string | null; world: number[16] }`, `HurtCapsule { bone; x1; x2; r }`, `SkeletonFile { schema; fighter; bones; hurt }`, `Rig3 { fighter; names; parent; restWorld; restLocalT; restLocalQ; byLower; hurt }`, `parseSkeletonFile(json): SkeletonFile` (throws `skeleton <fighter>: …`), `buildRig(file): Rig3`, `trimSkeleton(file, keep: (lowerName) => boolean): SkeletonFile`.
- Produces (`skeleton/testSkeleton.ts`): `testSkeleton(fighter = "test"): SkeletonFile` — 28 bones, 11 hurt capsules.

- [ ] **Step 1: Write the failing test** — `src/render3d/skeleton/skeleton.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { compose, mMul, mRotation, mTranslation, qAxisAngle, qRotate } from "../math/rigid";
import { buildRig, parseSkeletonFile, trimSkeleton } from "./skeleton";
import { testSkeleton } from "./testSkeleton";

describe("rigid maths", () => {
  it("composes, multiplies and decomposes like three.js (column-major)", () => {
    const q = qAxisAngle([0, 0, 1], Math.PI / 2);
    const m = compose([1, 2, 3], q);
    expect(mTranslation(m)).toEqual([1, 2, 3]);
    const r = mRotation(m);
    const v = qRotate(r, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(1, 12);
    const twice = mMul(m, m);
    expect(mTranslation(twice)[0]).toBeCloseTo(1 - 2, 12);
  });
});

describe("the skeleton file", () => {
  it("accepts the shape the Blender dump produces", () => {
    expect(parseSkeletonFile(testSkeleton()).bones).toHaveLength(28);
  });

  it("refuses duplicate names, missing parents, bad matrices and capsules on missing bones — by name", () => {
    const s = testSkeleton("bad");
    expect(() => parseSkeletonFile({ ...s, schema: 2 })).toThrow(/bad: schema 2/);
    expect(() => parseSkeletonFile({ ...s, bones: [...s.bones, { ...s.bones[3], name: "hip" }] })).toThrow(/two bones are called "hip"/);
    expect(() => parseSkeletonFile({ ...s, bones: s.bones.map((b) => (b.name === "Head" ? { ...b, parent: "Nope" } : b)) })).toThrow(/missing parent "Nope"/);
    expect(() => parseSkeletonFile({ ...s, bones: s.bones.map((b) => (b.name === "Head" ? { ...b, world: [1, 2] } : b)) })).toThrow(/Head" has no 16-number/);
    expect(() => parseSkeletonFile({ ...s, hurt: [{ bone: "Tail1", x1: 0, x2: 1, r: 1 }] })).toThrow(/missing bone "Tail1"/);
  });

  it("orders parents before children and recovers each bone's local transform", () => {
    const shuffled = testSkeleton();
    const rig = buildRig({ ...shuffled, bones: [...shuffled.bones].reverse() });
    rig.parent.forEach((p, i) => expect(p).toBeLessThan(i));
    const knee = rig.byLower.get("kneel")!;
    // KneeL sits 2.1 below LegL along LegL's +X (which points down).
    expect(rig.restLocalT[knee][0]).toBeCloseTo(2.1, 9);
  });

  it("trims to the bones asked for and every ancestor, keeping only their hurt capsules", () => {
    const t = trimSkeleton(testSkeleton(), (n) => n === "handl" || n === "head");
    expect(t.bones.map((b) => b.name)).toEqual(["Trans", "Rot", "Hip", "Waist", "Bust", "Neck", "Head", "ClavicleC", "ClavicleL", "ShoulderL", "ArmL", "HandL"]);
    expect(t.hurt.map((h) => h.bone).sort()).toEqual(["ArmL", "Bust", "Head", "Hip", "ShoulderL"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/skeleton`
Expected: FAIL — `Error: Failed to resolve import "../math/rigid" from "src/render3d/skeleton/skeleton.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/render3d/math/rigid.ts`:

```ts
/**
 * The little rigid-body maths the bake and the retargeter need, with no
 * three.js in it.
 *
 * The bake (`bake/bake.ts`) must be reproducible from a plain `vitest run`, so
 * it cannot depend on a rendering library's matrix conventions or version. The
 * renderer uses three.js, and `render3d/fighter3d.test.ts` proves the two agree.
 *
 * Conventions: quaternions are `[x, y, z, w]`; matrices are 4×4 **column-major**
 * (`m[12..14]` is the translation), the layout three.js and glTF both use.
 */

export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];
/** 16 numbers, column-major. */
export type Mat4 = readonly number[];

export const IDENTITY_Q: Quat = [0, 0, 0, 1];

export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qConj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation of `angle` radians about the unit `axis`. */
export function qAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Rotation about +X — the side view's screen normal in model space. */
export function qRotX(angle: number): Quat {
  return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/**
 * The shortest rotation taking unit vector `from` onto unit vector `to` (the
 * "swing"). Antiparallel vectors turn about +X, the side view's screen normal,
 * so a bone pointing straight up swings forward-and-down rather than sideways.
 */
export function qFromTo(from: Vec3, to: Vec3): Quat {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (d < -1 + 1e-9) return [1, 0, 0, 0];
  const cx = from[1] * to[2] - from[2] * to[1];
  const cy = from[2] * to[0] - from[0] * to[2];
  const cz = from[0] * to[1] - from[1] * to[0];
  return qNormalize([cx, cy, cz, 1 + d]);
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n < 1e-12) throw new Error("cannot normalise a zero-length vector");
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Translation, rotation and per-axis scale → column-major matrix (three.js `compose`). */
export function compose(t: Vec3, q: Quat, s: Vec3 = [1, 1, 1]): number[] {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export function mMul(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** Inverse of a rigid transform (orthonormal rotation + translation). */
export function mInvertRigid(m: Mat4): number[] {
  const out = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  out[12] = -(out[0] * m[12] + out[4] * m[13] + out[8] * m[14]);
  out[13] = -(out[1] * m[12] + out[5] * m[13] + out[9] * m[14]);
  out[14] = -(out[2] * m[12] + out[6] * m[13] + out[10] * m[14]);
  return out;
}

export function mTranslation(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]];
}

/** Column `i` (0 = local X axis) of a matrix's 3×3 part. */
export function mAxis(m: Mat4, i: 0 | 1 | 2): Vec3 {
  return [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
}

/** The rotation of an orthonormal (unscaled) matrix, as a quaternion. */
export function mRotation(m: Mat4): Quat {
  const m11 = m[0];
  const m12 = m[4];
  const m13 = m[8];
  const m21 = m[1];
  const m22 = m[5];
  const m23 = m[9];
  const m31 = m[2];
  const m32 = m[6];
  const m33 = m[10];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return qNormalize([(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]);
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return qNormalize([0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]);
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return qNormalize([(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]);
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return qNormalize([(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]);
}
```

`src/render3d/skeleton/skeleton.ts`:

```ts
/**
 * A fighter's SSBU skeleton, as the bake and the renderer read it.
 *
 * The numbers come from the Blender spike (`scripts/models/export_gltf.py`):
 * every bone's bind-pose world matrix in **SSBU model space** — +Y up, +Z the
 * fighter's forward, +X the fighter's left, one unit = one simulation unit —
 * column-major. `scripts/models/skeleton.mjs` trims that dump to the bones the
 * sim and the retargeter use (and their ancestors) and commits it as
 * `src/render3d/skeletons/<fighterId>.json`: derived numbers, never a mesh or a
 * texture (spec §3.1).
 *
 * `parseSkeletonFile` refuses anything that is not that shape, loudly, because a
 * skeleton that is quietly wrong produces hitboxes that are quietly wrong.
 */

import { mInvertRigid, mMul, mRotation, mTranslation, normalize, type Mat4, type Quat, type Vec3 } from "../math/rigid";

export const SKELETON_SCHEMA = 1;

export interface SkeletonBone {
  readonly name: string;
  readonly parent: string | null;
  /** Bind-pose world matrix, SSBU model space, column-major. */
  readonly world: readonly number[];
}

/** A hurtbox capsule along a bone's local +X, bone-local units. UNVERIFIED: derived from mesh weights. */
export interface HurtCapsule {
  readonly bone: string;
  readonly x1: number;
  readonly x2: number;
  readonly r: number;
}

export interface SkeletonFile {
  readonly schema: typeof SKELETON_SCHEMA;
  readonly fighter: string;
  readonly bones: readonly SkeletonBone[];
  readonly hurt: readonly HurtCapsule[];
}

/** A skeleton ready to pose: parents before children, rest transforms split. */
export interface Rig3 {
  readonly fighter: string;
  readonly names: readonly string[];
  /** Parent index, −1 for a root. Always less than the bone's own index. */
  readonly parent: readonly number[];
  readonly restWorld: readonly Mat4[];
  readonly restLocalT: readonly Vec3[];
  readonly restLocalQ: readonly Quat[];
  /** Lower-case name → index (scripts spell bones in lower case: "kneer"). */
  readonly byLower: ReadonlyMap<string, number>;
  readonly hurt: readonly HurtCapsule[];
}

function fail(fighter: string, why: string): never {
  throw new Error(`skeleton ${fighter}: ${why}`);
}

export function parseSkeletonFile(json: unknown): SkeletonFile {
  const o = json as Partial<SkeletonFile> | null;
  const fighter = typeof o?.fighter === "string" ? o.fighter : "?";
  if (o === null || typeof o !== "object") fail(fighter, "not an object");
  if (o.schema !== SKELETON_SCHEMA) fail(fighter, `schema ${String(o.schema)}, expected ${SKELETON_SCHEMA}`);
  if (!Array.isArray(o.bones) || o.bones.length === 0) fail(fighter, "no bones");
  const seen = new Set<string>();
  for (const b of o.bones) {
    if (typeof b.name !== "string" || b.name.length === 0) fail(fighter, "a bone has no name");
    if (seen.has(b.name.toLowerCase())) fail(fighter, `two bones are called "${b.name}" (case-insensitively)`);
    seen.add(b.name.toLowerCase());
    if (!Array.isArray(b.world) || b.world.length !== 16 || b.world.some((v: number) => !Number.isFinite(v))) {
      fail(fighter, `bone "${b.name}" has no 16-number world matrix`);
    }
  }
  for (const b of o.bones) {
    if (b.parent !== null && !seen.has(b.parent.toLowerCase())) fail(fighter, `bone "${b.name}" names missing parent "${b.parent}"`);
  }
  if (!Array.isArray(o.hurt)) fail(fighter, "no hurt list");
  for (const h of o.hurt) {
    if (!seen.has(h.bone.toLowerCase())) fail(fighter, `hurt capsule on missing bone "${h.bone}"`);
    if (!(h.r > 0) || !Number.isFinite(h.x1) || !Number.isFinite(h.x2)) fail(fighter, `hurt capsule on "${h.bone}" is malformed`);
  }
  return o as SkeletonFile;
}

/**
 * The dump rounds to five decimals, which leaves a bind rotation a hair off
 * orthonormal; inverting it as rigid would then leak ~1e-4 into every local
 * transform. Rebuild the frame from its X and Y axes (Gram–Schmidt) first.
 */
function orthonormal(m: readonly number[]): number[] {
  const x = normalize([m[0], m[1], m[2]]);
  const y0: Vec3 = [m[4], m[5], m[6]];
  const z = normalize([x[1] * y0[2] - x[2] * y0[1], x[2] * y0[0] - x[0] * y0[2], x[0] * y0[1] - x[1] * y0[0]]);
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [...x, 0, ...y, 0, ...z, 0, m[12], m[13], m[14], 1];
}

/** Order parents before children, split each bind matrix into a local translation and rotation. */
export function buildRig(file: SkeletonFile): Rig3 {
  const byName = new Map(file.bones.map((b) => [b.name, b]));
  const ordered: SkeletonBone[] = [];
  const placed = new Set<string>();
  const visit = (b: SkeletonBone, depth: number): void => {
    if (placed.has(b.name)) return;
    if (depth > file.bones.length) fail(file.fighter, `bone "${b.name}" is its own ancestor`);
    if (b.parent !== null) visit(byName.get(b.parent)!, depth + 1);
    placed.add(b.name);
    ordered.push(b);
  };
  for (const b of file.bones) visit(b, 0);

  const index = new Map(ordered.map((b, i) => [b.name, i]));
  const parent = ordered.map((b) => (b.parent === null ? -1 : index.get(b.parent)!));
  const restWorld = ordered.map((b) => orthonormal(b.world));
  const restLocalT: Vec3[] = [];
  const restLocalQ: Quat[] = [];
  ordered.forEach((b, i) => {
    const local = parent[i] < 0 ? b.world : mMul(mInvertRigid(restWorld[parent[i]]), b.world);
    restLocalT.push(mTranslation(local));
    restLocalQ.push(mRotation(local));
  });
  return {
    fighter: file.fighter,
    names: ordered.map((b) => b.name),
    parent,
    restWorld,
    restLocalT,
    restLocalQ,
    byLower: new Map(ordered.map((b, i) => [b.name.toLowerCase(), i])),
    hurt: file.hurt,
  };
}

/**
 * Keep the bones `keep` asks for and every ancestor of them, in their original
 * order — so the trimmed skeleton poses exactly like the full one.
 */
export function trimSkeleton(file: SkeletonFile, keep: (lowerName: string) => boolean): SkeletonFile {
  const byName = new Map(file.bones.map((b) => [b.name, b]));
  const wanted = new Set<string>();
  for (const b of file.bones) {
    if (!keep(b.name.toLowerCase())) continue;
    for (let at: SkeletonBone | undefined = b; at !== undefined; at = at.parent === null ? undefined : byName.get(at.parent)) {
      wanted.add(at.name);
    }
  }
  return {
    schema: SKELETON_SCHEMA,
    fighter: file.fighter,
    bones: file.bones.filter((b) => wanted.has(b.name)),
    hurt: file.hurt.filter((h) => wanted.has(h.bone)),
  };
}
```

`src/render3d/skeleton/testSkeleton.ts`:

```ts
/**
 * An invented, SSBU-shaped skeleton for tests — so every module can be proven
 * before the Blender spike has produced a real one, and without a single
 * Nintendo-derived number in a fixture.
 *
 * It copies the *conventions* the spike's dump uses (verified on the real
 * Mario dump, Plan 4 Task 4): bind pose is a T-pose; +Y up, +Z forward, +X the
 * fighter's left; spine bones' local +X points up; limb bones' local +X points
 * along the limb toward the child; names are SSBU's (`Hip`, `KneeR`, `HandL`).
 * The proportions are round numbers, not Mario's.
 */

import type { HurtCapsule, SkeletonBone, SkeletonFile } from "./skeleton";
import { SKELETON_SCHEMA } from "./skeleton";
import { normalize, type Vec3 } from "../math/rigid";

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A bone whose local X is `x` and local Y is `y` (re-orthogonalised), at `at`. */
function bone(name: string, parent: string | null, at: Vec3, x: Vec3, y: Vec3): SkeletonBone {
  const X = normalize(x);
  const Z = normalize(cross(X, y));
  const Y = cross(Z, X);
  return { name, parent, world: [...X, 0, ...Y, 0, ...Z, 0, at[0], at[1], at[2], 1] };
}

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
const FWD: Vec3 = [0, 0, 1];
const BACK: Vec3 = [0, 0, -1];
const LEFT: Vec3 = [1, 0, 0];
const RIGHT: Vec3 = [-1, 0, 0];

export function testSkeleton(fighter = "test"): SkeletonFile {
  const bones: SkeletonBone[] = [
    bone("Trans", null, [0, 0, 0], LEFT, UP),
    bone("Rot", "Trans", [0, 6, 0], LEFT, UP),
    bone("Hip", "Rot", [0, 5.5, 0], UP, FWD),
    bone("Waist", "Hip", [0, 6.5, 0], UP, FWD),
    bone("Bust", "Waist", [0, 8, 0], UP, FWD),
    bone("Neck", "Bust", [0, 9, 0], UP, FWD),
    bone("Head", "Neck", [0, 10, 0], UP, FWD),
    bone("ClavicleC", "Bust", [0, 8.7, 0], LEFT, FWD),
    bone("ClavicleL", "ClavicleC", [1, 8.7, 0], LEFT, FWD),
    bone("ShoulderL", "ClavicleL", [2, 8.7, 0], LEFT, FWD),
    bone("ArmL", "ShoulderL", [3.8, 8.7, 0], LEFT, FWD),
    bone("HandL", "ArmL", [5.4, 8.7, 0], LEFT, DOWN),
    bone("HaveL", "HandL", [6.8, 8.6, 0], LEFT, UP),
    bone("ClavicleR", "ClavicleC", [-1, 8.7, 0], RIGHT, FWD),
    bone("ShoulderR", "ClavicleR", [-2, 8.7, 0], RIGHT, FWD),
    bone("ArmR", "ShoulderR", [-3.8, 8.7, 0], RIGHT, FWD),
    bone("HandR", "ArmR", [-5.4, 8.7, 0], RIGHT, DOWN),
    bone("HaveR", "HandR", [-6.8, 8.6, 0], RIGHT, UP),
    bone("LegC", "Hip", [0, 5.5, 0], LEFT, UP),
    bone("LegL", "LegC", [1.2, 5.5, 0], DOWN, BACK),
    bone("KneeL", "LegL", [1.2, 3.4, 0], DOWN, BACK),
    bone("FootL", "KneeL", [1.2, 1.5, 0], DOWN, BACK),
    bone("ToeL", "FootL", [1.2, 0.8, 1.3], FWD, DOWN),
    bone("LegR", "LegC", [-1.2, 5.5, 0], DOWN, BACK),
    bone("KneeR", "LegR", [-1.2, 3.4, 0], DOWN, BACK),
    bone("FootR", "KneeR", [-1.2, 1.5, 0], DOWN, BACK),
    bone("ToeR", "FootR", [-1.2, 0.8, 1.3], FWD, DOWN),
    bone("Throw", "Rot", [0, 0, 0], LEFT, UP),
  ];
  const hurt: HurtCapsule[] = [
    { bone: "Head", x1: 0.5, x2: 2.5, r: 2 },
    { bone: "Bust", x1: -1.5, x2: 1, r: 2 },
    { bone: "Hip", x1: -0.5, x2: 1, r: 1.8 },
    { bone: "ShoulderL", x1: 0, x2: 1.8, r: 0.8 },
    { bone: "ArmL", x1: 0, x2: 2.2, r: 0.8 },
    { bone: "ShoulderR", x1: 0, x2: 1.8, r: 0.8 },
    { bone: "ArmR", x1: 0, x2: 2.2, r: 0.8 },
    { bone: "LegL", x1: 0, x2: 2.1, r: 1 },
    { bone: "KneeL", x1: 0, x2: 2.4, r: 0.9 },
    { bone: "LegR", x1: 0, x2: 2.1, r: 1 },
    { bone: "KneeR", x1: 0, x2: 2.4, r: 0.9 },
  ];
  return { schema: SKELETON_SCHEMA, fighter, bones, hurt };
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render3d/skeleton`
Expected: PASS (5 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render3d/math/rigid.ts super-smash/src/render3d/skeleton/skeleton.ts super-smash/src/render3d/skeleton/testSkeleton.ts super-smash/src/render3d/skeleton/skeleton.test.ts
git commit -m "super-smash: rigid maths and the committed skeleton format for the 3D renderer" -m "Column-major matrices and quaternions with no three.js, so the bone bake is reproducible in vitest; the skeleton file the bone dumps are trimmed to, validated loudly; an invented SSBU-shaped skeleton for tests." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Retargeting the 2D clips onto an SSBU skeleton

The existing pose clips stay the animation source (spec §1). A 2D bone's accumulated angle `a` (0 = up, clockwise toward the front) is the side-plane direction (forward, up) = (sin a, cos a); in SSBU model space that is (0, cos a, sin a), reached from "up" by a turn of `a` about +X, the side view's screen normal. Each driven SSBU bone is calibrated once per fighter so that the 2D rest pose reproduces SSBU's own stance (spine, legs, feet: rest "bind") or, for the T-posed arms whose bind direction has no side-plane angle, hangs them straight down first (rest "down"). Only rotations are driven; every bone keeps SSBU's length, so hitboxes hang off SSBU's limbs. `spin` (D48) arrives folded into `rotation`, which pivots about the pelvis exactly as `resolve()` does.

A "down" foot was tried first on the real Mario skeleton: the 2D foot's horizontal rest lifted his toes 0.7 units off the floor, which is why the legs and feet are "bind". The spine stays "bind" too: every 2D rig's hip, torso and head rest at angle 0 and their clips lean them by a few degrees (Donkey Kong's idle: torso 5.5°, head −4.1°), so an absolute "up" spine would differ from "bind" only by SSBU's own bind tilt — and "bind" keeps each model's real posture and size, which D57 adopts (on the real skeletons Donkey Kong stands 26.3 units tall at rest, hunched forward by his own spine).

**Files:**
- Create: `super-smash/src/render3d/retarget/map.ts`, `super-smash/src/render3d/retarget/retarget.ts`, `super-smash/src/render3d/retarget/retarget.test.ts`, `super-smash/src/render3d/bake/fk.ts` (the forward kinematics the test needs; Task 4 adds its own tests and the projection)

**Interfaces:**
- Consumes: `BONE_NAMES`, `BoneName`, `PoseAngles`, `Rig`, `BASE_RIG`, `resolve` (`src/render/skeleton.ts`); `angleDelta` (`src/render/poses/clip.ts`).
- Produces (`retarget/map.ts`): `Drive { bones; tips?; rest: "bind" | "down"; optional? }`, `RETARGET: Partial<Record<BoneName, Drive>>`, `RETARGET_OVERRIDES: Record<fighterId, Partial<Record<BoneName, Drive>>>` (empty), `PIVOT_BONE = "Hip"`.
- Produces (`retarget/retarget.ts`): `Calibration { rig; drives; pivotY }`, `calibrate(rig: Rig3, rig2d: Rig): Calibration` (throws `retarget <fighter>: skeleton lacks <bone> (tried …)`), `accumulatedAngles(rig2d, angles, rotation): Record<BoneName, number>`, `LocalPose { q: Quat[]; t: Vec3[] }`, `retarget(cal, rig2d, angles, rotation): LocalPose`, `restPose(rig): LocalPose`.
- Produces (`bake/fk.ts`): `RootXform { forward; up; squashForward; squashUp; scale }`, `IDENTITY_ROOT`, `rootMatrix`, `worldMatrices(rig, pose, root): number[][]`, `sideBonePose(m): BonePose`.

- [ ] **Step 1: Write the failing test** — `src/render3d/retarget/retarget.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { angleDelta } from "@/render/poses/clip";
import { BASE_RIG, deg, resolve } from "@/render/skeleton";
import { IDENTITY_ROOT, worldMatrices } from "../bake/fk";
import { mAxis, mTranslation, normalize } from "../math/rigid";
import { buildRig } from "../skeleton/skeleton";
import { testSkeleton } from "../skeleton/testSkeleton";
import { accumulatedAngles, calibrate, retarget } from "./retarget";

const rig = buildRig(testSkeleton());
const cal = calibrate(rig, BASE_RIG);
const at = (name: string) => rig.byLower.get(name.toLowerCase())!;
const posed = (angles: Parameters<typeof retarget>[2], rotation = 0) =>
  worldMatrices(rig, retarget(cal, BASE_RIG, angles, rotation), IDENTITY_ROOT);
const REST = posed({});

/** Side-plane angle (0 = up, + toward the front) of the vector between two bones. */
function sideAngle(world: number[][], from: string, to: string): number {
  const a = mTranslation(world[at(from)]);
  const b = mTranslation(world[at(to)]);
  const d = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  return Math.atan2(d[2], d[1]);
}

describe("retargeting a 2D pose onto an SSBU skeleton", () => {
  it("points the arms exactly where the 2D arm points (rest 'down': T-pose arms have no side-plane angle)", () => {
    const angles = { upperArmL: deg(-80), forearmL: deg(30), upperArmR: deg(100), forearmR: deg(-20) };
    const world = posed(angles);
    const acc = accumulatedAngles(BASE_RIG, angles, 0);
    expect(angleDelta(acc.upperArmL, sideAngle(world, "ShoulderL", "ArmL"))).toBeCloseTo(0, 9);
    expect(angleDelta(acc.forearmL, sideAngle(world, "ArmL", "HandL"))).toBeCloseTo(0, 9);
    expect(angleDelta(acc.upperArmR, sideAngle(world, "ShoulderR", "ArmR"))).toBeCloseTo(0, 9);
    expect(angleDelta(acc.forearmR, sideAngle(world, "ArmR", "HandR"))).toBeCloseTo(0, 9);
  });

  it("turns legs, feet and spine by the clip's angle relative to rest (rest 'bind')", () => {
    const angles = { thighR: deg(150), shinR: deg(40), footR: deg(-30), torso: deg(25) };
    const world = posed(angles);
    const acc = accumulatedAngles(BASE_RIG, angles, 0);
    const rest = accumulatedAngles(BASE_RIG, {}, 0);
    const turned = (from: string, to: string) => angleDelta(sideAngle(REST, from, to), sideAngle(world, from, to));
    expect(angleDelta(turned("LegR", "KneeR"), acc.thighR - rest.thighR)).toBeCloseTo(0, 9);
    expect(angleDelta(turned("KneeR", "FootR"), acc.shinR - rest.shinR)).toBeCloseTo(0, 9);
    expect(angleDelta(turned("FootR", "ToeR"), acc.footR - rest.footR)).toBeCloseTo(0, 9);
    const bust = mAxis(world[at("Bust")], 0);
    expect(angleDelta(Math.atan2(bust[2], bust[1]), acc.torso - rest.torso)).toBeCloseTo(0, 9);
  });

  it("stands in SSBU's own stance at the 2D rest pose: feet flat, legs and head where the bind pose has them", () => {
    for (const bone of ["Head", "KneeL", "FootR", "ToeL", "ToeR"]) {
      const want = mTranslation(rig.restWorld[at(bone)]);
      const got = mTranslation(REST[at(bone)]);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 9);
    }
  });

  it("brings the T-pose arms down: at rest the hands hang below the shoulders", () => {
    expect(mTranslation(REST[at("HandL")])[1]).toBeLessThan(mTranslation(REST[at("ShoulderL")])[1] - 2.5);
    expect(mTranslation(REST[at("HandR")])[1]).toBeLessThan(mTranslation(REST[at("ShoulderR")])[1] - 2.5);
  });

  it("keeps SSBU's bone lengths: the limbs are the model's, only the angles are the clip's", () => {
    const world = posed({ thighL: deg(120), shinL: deg(-90) });
    const len = (a: string, b: string) => {
      const p = mTranslation(world[at(a)]);
      const q = mTranslation(world[at(b)]);
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    expect(len("LegL", "KneeL")).toBeCloseTo(2.1, 9);
    expect(len("KneeL", "FootL")).toBeCloseTo(1.9, 9);
  });

  it("swings limbs only in the side plane: a limb never leaves its own depth", () => {
    const world = posed({ upperArmR: deg(60), forearmR: deg(-100) });
    expect(mTranslation(world[at("ArmR")])[0]).toBeCloseTo(-2, 9);
    expect(mTranslation(world[at("HandR")])[0]).toBeCloseTo(-2, 9);
  });

  it("turns the whole body about the pelvis, as resolve() does, so a somersault does not orbit the feet", () => {
    const quarter = Math.PI / 2;
    const world = posed({}, quarter);
    const hip = mTranslation(world[at("Hip")]);
    expect(hip[1]).toBeCloseTo(cal.pivotY, 9);
    expect(hip[2]).toBeCloseTo(0, 9);
    const head = mTranslation(world[at("Head")]);
    expect(head[2]).toBeGreaterThan(3);
    expect(head[1]).toBeCloseTo(cal.pivotY, 6);
    // The 2D renderer agrees about which way a positive rotation turns.
    const sk = resolve(BASE_RIG, {}, { x: 0, y: 0, scale: 1, facing: 1, rotation: quarter });
    expect(sk.head.x1).toBeGreaterThan(sk.hip.x0);
  });

  it("names the bone a skeleton is missing, rather than posing a broken rig", () => {
    const broken = testSkeleton("broken");
    const noKnee = { ...broken, bones: broken.bones.filter((b) => !["KneeR", "FootR", "ToeR"].includes(b.name)) };
    expect(() => calibrate(buildRig(noKnee), BASE_RIG)).toThrow(/broken: skeleton lacks/);
  });

  it("refuses a 'bind' drive whose bind direction is sideways, naming the fix", () => {
    const sideways = testSkeleton("sideways");
    const bones = sideways.bones.map((b) =>
      // Lay the left thigh out sideways, as a T-pose arm is.
      b.name === "KneeL" ? { ...b, world: [...b.world.slice(0, 12), 3.3, 5.5, 0, 1] } : b,
    );
    expect(() => calibrate(buildRig({ ...sideways, bones }), BASE_RIG)).toThrow(/LegL points sideways.*thighL rest "down"/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/retarget`
Expected: FAIL — `Error: Failed to resolve import "../bake/fk" from "src/render3d/retarget/retarget.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/render3d/retarget/map.ts`:

```ts
/**
 * Which SSBU bones each of the replica's sixteen 2D bones drives.
 *
 * The 2D rig (`render/skeleton.ts`) is a chain of angles in the screen plane;
 * an SSBU skeleton is ~100 bones in 3D. Only the bones a pose clip names are
 * driven: each listed SSBU bone is turned so that its **along-axis** — the
 * vector from the bone to `tip` (or its local +X when there is no tip) — points
 * where the 2D bone points, in the side (sagittal) plane. Every other bone keeps
 * its bind pose relative to its parent and rides along.
 *
 * Bone names are SSBU's, as the importer writes them into the .blend
 * (verified on the Mario dump: `Hip`, `Waist`, `Bust`, `Neck`, `Head`,
 * `ClavicleL`, `ShoulderL`, `ArmL`, `HandL`, `HaveL`, `LegL`, `KneeL`, `FootL`,
 * `ToeL`; ACMD scripts spell the same bones in lower case: `kneer`, `arml`).
 * `ShoulderL` is the upper arm, `ArmL` the forearm, `LegL` the thigh and
 * `KneeL` the shin: SSBU names a limb segment after the joint it starts at.
 *
 * `rest` is how the 2D rest pose meets the SSBU bind pose:
 * - "bind": the 2D bone's rest angle reproduces the SSBU bind direction (in the
 *   side plane), and a clip turns the bone by its angle *relative to rest*. Used
 *   for the spine, head, legs and feet, whose bind directions already lie in the
 *   side plane — so a fighter at rest stands exactly in SSBU's own stance, feet
 *   flat and spine at its own tilt. (A "down" foot was tried on the real Mario
 *   dump first: the 2D foot's horizontal rest lifted his toes 0.7 units.)
 * - "down": the bone is first laid straight down, then turned to the 2D
 *   angle. Used for the arms, whose T-pose bind direction is sideways and has no
 *   side-plane angle to keep.
 */

import type { BoneName } from "@/render/skeleton";

export interface Drive {
  /** SSBU bones turned together to this 2D bone's direction; every present one is driven. */
  readonly bones: readonly string[];
  /** Child bone defining the along-axis; absent means local +X. Must share the order of `bones`. */
  readonly tips?: readonly (string | null)[];
  readonly rest: "bind" | "down";
  /** True when a skeleton may lack every listed bone (the drive is skipped). */
  readonly optional?: boolean;
}

export const RETARGET: Readonly<Partial<Record<BoneName, Drive>>> = {
  hip: { bones: ["Hip"], rest: "bind" },
  torso: { bones: ["Waist", "Bust"], rest: "bind" },
  head: { bones: ["Neck", "Head"], rest: "bind" },
  thighL: { bones: ["LegL"], tips: ["KneeL"], rest: "bind" },
  shinL: { bones: ["KneeL"], tips: ["FootL"], rest: "bind" },
  footL: { bones: ["FootL"], tips: ["ToeL"], rest: "bind" },
  thighR: { bones: ["LegR"], tips: ["KneeR"], rest: "bind" },
  shinR: { bones: ["KneeR"], tips: ["FootR"], rest: "bind" },
  footR: { bones: ["FootR"], tips: ["ToeR"], rest: "bind" },
  upperArmL: { bones: ["ShoulderL"], tips: ["ArmL"], rest: "down" },
  forearmL: { bones: ["ArmL"], tips: ["HandL"], rest: "down" },
  handL: { bones: ["HandL"], tips: ["HaveL"], rest: "down" },
  upperArmR: { bones: ["ShoulderR"], tips: ["ArmR"], rest: "down" },
  forearmR: { bones: ["ArmR"], tips: ["HandR"], rest: "down" },
  handR: { bones: ["HandR"], tips: ["HaveR"], rest: "down" },
};

/**
 * Per-fighter replacements for `RETARGET` entries, for skeletons that do not
 * follow the humanoid naming. Empty until the spike's dumps say otherwise:
 * `retarget.test.ts` runs every committed skeleton through `calibrate`, which
 * names the missing bone, so an entry here is added only against that failure.
 */
export const RETARGET_OVERRIDES: Readonly<Record<string, Readonly<Partial<Record<BoneName, Drive>>>>> = {};

/** The bone whose bind height is the whole-body rotation pivot (the 2D rig pivots at the pelvis). */
export const PIVOT_BONE = "Hip";
```

`src/render3d/retarget/retarget.ts`:

```ts
/**
 * Retargeting: a 2D pose sample → local rotations for an SSBU skeleton.
 *
 * ## The rule
 *
 * A 2D bone at accumulated angle `a` (rig space: 0 = up, clockwise positive
 * toward the fighter's front, `skeleton.ts`) points along (forward, up) =
 * (sin a, cos a). In SSBU model space forward is +Z and up is +Y, so the target
 * is the model-space direction (0, cos a, sin a), and the turn that reaches it
 * from straight up is a rotation of `a` about +X — the side view's screen normal.
 *
 * Each driven SSBU bone is calibrated once per fighter (`map.ts` `rest`):
 * - "bind": `base` is its bind rotation, with any sideways lean swung out so its
 *   along-axis lies in the side plane at angle β; `ref` is the 2D bone's own
 *   rest angle. At the 2D rest pose the bone sits at β, SSBU's stance.
 * - "down": `base` is its bind rotation swung so its along-axis points straight
 *   down; `ref` is 180°.
 * Its world rotation for a pose is then
 *
 *   world = Rx(a − ref) · base
 *
 * and its local rotation is that world rotation seen from its (already posed)
 * parent. Undriven bones keep their bind-local rotation. Translations are always
 * bind-local: SSBU's limbs keep SSBU's lengths, which is the point — hitboxes
 * hang off the real limbs.
 *
 * ## Whole-body channels
 *
 * `rotation` (key rotation plus `spin`) and the 2D root bone's angle turn the
 * whole body about +X at the root bone; `rotation` pivots about the pelvis
 * exactly as `resolve()` does. Offsets and squash are the caller's
 * (`rootXform`), because squash is not a rigid transform and offsets are not
 * scaled by it in the 2D renderer either.
 *
 * Pure: `Math` only, no three.js, so `bake/bake.ts` runs it at build time and
 * the renderer runs it per frame, and `fighter3d.test.ts` proves they agree.
 */

import { BONE_NAMES, type BoneName, type PoseAngles, type Rig } from "@/render/skeleton";
import {
  mAxis,
  mRotation,
  mTranslation,
  normalize,
  qConj,
  qFromTo,
  qMul,
  qRotate,
  qRotX,
  type Quat,
  type Vec3,
} from "../math/rigid";
import type { Rig3 } from "../skeleton/skeleton";
import { PIVOT_BONE, RETARGET, RETARGET_OVERRIDES, type Drive } from "./map";

interface DriveEntry {
  readonly index: number;
  readonly our: BoneName;
  readonly base: Quat;
  readonly ref: number;
}

export interface Calibration {
  readonly rig: Rig3;
  readonly drives: readonly DriveEntry[];
  /** World height of the pelvis in bind pose, model units. */
  readonly pivotY: number;
}

const DIR_DOWN: Vec3 = [0, -1, 0];

function driveFor(fighter: string, our: BoneName): Drive | undefined {
  return RETARGET_OVERRIDES[fighter]?.[our] ?? RETARGET[our];
}

/**
 * Precompute every driven bone's reference rotation against the fighter's 2D
 * rig (`rig2d` supplies the rest angles a "bind" drive is relative to). Throws
 * naming the missing bone.
 */
export function calibrate(rig: Rig3, rig2d: Rig): Calibration {
  const drives: DriveEntry[] = [];
  const rest2d = accumulatedAngles(rig2d, {}, 0);
  for (const our of BONE_NAMES) {
    const drive = driveFor(rig.fighter, our);
    if (!drive) continue;
    const present = drive.bones.map((b) => rig.byLower.get(b.toLowerCase()));
    if (present.every((i) => i === undefined)) {
      if (drive.optional) continue;
      throw new Error(`retarget ${rig.fighter}: skeleton lacks ${our}'s bone (tried ${drive.bones.join(", ")})`);
    }
    drive.bones.forEach((name, k) => {
      const index = present[k];
      if (index === undefined) return;
      const world = rig.restWorld[index];
      const tipName = drive.tips?.[k] ?? null;
      let along: Vec3;
      if (tipName !== null) {
        const tip = rig.byLower.get(tipName.toLowerCase());
        if (tip === undefined) throw new Error(`retarget ${rig.fighter}: skeleton lacks ${name}'s tip ${tipName}`);
        const a = mTranslation(world);
        const b = mTranslation(rig.restWorld[tip]);
        along = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      } else {
        along = normalize(mAxis(world, 0));
      }
      if (drive.rest === "down") {
        drives.push({ index, our, base: qMul(qFromTo(along, DIR_DOWN), mRotation(world)), ref: Math.PI });
        return;
      }
      // "bind": keep the bind direction's side-plane angle, drop its sideways lean.
      const side = Math.hypot(along[1], along[2]);
      if (side < 0.5) {
        throw new Error(`retarget ${rig.fighter}: ${name} points sideways in its bind pose; give ${our} rest "down"`);
      }
      const inPlane: Vec3 = [0, along[1] / side, along[2] / side];
      drives.push({ index, our, base: qMul(qFromTo(along, inPlane), mRotation(world)), ref: rest2d[our] });
    });
  }
  const pivot = rig.byLower.get(PIVOT_BONE.toLowerCase());
  if (pivot === undefined) throw new Error(`retarget ${rig.fighter}: skeleton lacks ${PIVOT_BONE}`);
  return { rig, drives, pivotY: mTranslation(rig.restWorld[pivot])[1] };
}

/** Accumulated 2D angles, the way `resolve()` walks them. */
export function accumulatedAngles(rig2d: Rig, angles: PoseAngles, rotation: number): Record<BoneName, number> {
  const out = {} as Record<BoneName, number>;
  for (const name of BONE_NAMES) {
    const bone = rig2d[name];
    out[name] = (bone.parent ? out[bone.parent] : rotation) + (angles[name] ?? bone.angle);
  }
  return out;
}

export interface LocalPose {
  /** Local rotation per `Rig3` bone, parent-relative. */
  readonly q: readonly Quat[];
  /** Local translation per bone, parent-relative (bind, except the root's pivot shift). */
  readonly t: readonly Vec3[];
}

/**
 * Local rotations and translations for every bone of `cal.rig`.
 *
 * `rig2d` supplies rest angles for bones the sample does not name, exactly as
 * `resolve()` does; `rotation` already includes any `spin`.
 */
export function retarget(cal: Calibration, rig2d: Rig, angles: PoseAngles, rotation: number): LocalPose {
  const { rig } = cal;
  const n = rig.names.length;
  const acc = accumulatedAngles(rig2d, angles, rotation);
  const wanted = new Map<number, Quat>();
  for (const d of cal.drives) wanted.set(d.index, qMul(qRotX(acc[d.our] - d.ref), d.base));

  const worldQ: Quat[] = new Array(n);
  const q: Quat[] = new Array(n);
  const t: Vec3[] = rig.restLocalT.slice();
  // Whole body: the 2D root's angle and the pose rotation turn everything at the
  // root; `rotation` alone pivots about the pelvis (resolve()'s P − R·P shift).
  const bodyTurn = acc.root;
  for (let i = 0; i < n; i++) {
    const p = rig.parent[i];
    if (p < 0) {
      const turn = qRotX(bodyTurn);
      const local = qMul(turn, rig.restLocalQ[i]);
      const pivot: Vec3 = [0, cal.pivotY, 0];
      const spun = qRotate(qRotX(rotation), pivot);
      const base = rig.restLocalT[i];
      t[i] = [base[0], base[1] + pivot[1] - spun[1], base[2] + pivot[2] - spun[2]];
      q[i] = local;
      worldQ[i] = local;
      continue;
    }
    const w = wanted.get(i);
    if (w === undefined) {
      q[i] = rig.restLocalQ[i];
      worldQ[i] = qMul(worldQ[p], q[i]);
    } else {
      q[i] = qMul(qConj(worldQ[p]), w);
      worldQ[i] = w;
    }
  }
  return { q, t };
}

/** The bind pose as a `LocalPose`. */
export function restPose(rig: Rig3): LocalPose {
  return { q: rig.restLocalQ.slice(), t: rig.restLocalT.slice() };
}
```

`src/render3d/bake/fk.ts` (its quantum constant comes from Task 10's codec; until then the import below must exist, so create `src/engine/acmd/bakeCodec.ts` now with only this line and Task 10 fills it in: `export const BAKE_QUANTUM = 16;`):

```ts
/**
 * Forward kinematics and the projection onto the sim's side plane.
 *
 * The sim's `BonePose` (Plan 2, `engine/acmd/bones.ts`) is a bone's transform
 * in the fighter's facing-relative side plane: +x forward, +y up, origin at the
 * feet, Q12. SSBU model space has forward = +Z and up = +Y, so the projection
 * keeps the Z and Y rows of the bone's world matrix and drops X (depth):
 *
 *   x = m.Z·(lx, ly, lz) + t.z      y = m.Y·(lx, ly, lz) + t.y
 *
 * which is exactly `bonePoint`'s `m0* / m1*` rows. The root bone `top` in Plan
 * 2's `TOP_POSE` is the identity matrix under this projection, which is how the
 * legacy root-bone scripts and the baked limb bones share one coordinate frame.
 */

import { ONE } from "@/engine/fixed";
import type { BonePose } from "@/engine/acmd/bones";
import { BAKE_QUANTUM } from "@/engine/acmd/bakeCodec";
import { compose, mMul, type Mat4 } from "../math/rigid";
import type { Rig3 } from "../skeleton/skeleton";
import type { LocalPose } from "../retarget/retarget";

/** The whole-body transform the renderer puts on the fighter's group, in model space. */
export interface RootXform {
  /** Clip offsets in model units: +forward, +up. */
  readonly forward: number;
  readonly up: number;
  /** Clip squash: `scaleX` stretches forward, `scaleY` up. */
  readonly squashForward: number;
  readonly squashUp: number;
  /** The fighter's own size (`FighterParams.scale`, e.g. Fox 1.08). */
  readonly scale: number;
}

export const IDENTITY_ROOT: RootXform = { forward: 0, up: 0, squashForward: 1, squashUp: 1, scale: 1 };

export function rootMatrix(r: RootXform): number[] {
  return compose([0, r.up, r.forward], [0, 0, 0, 1], [r.scale, r.scale * r.squashUp, r.scale * r.squashForward]);
}

/** Every bone's world matrix (model space, root transform applied), parents first. */
export function worldMatrices(rig: Rig3, pose: LocalPose, root: RootXform): number[][] {
  const rootM = rootMatrix(root);
  const out: number[][] = new Array(rig.names.length);
  for (let i = 0; i < rig.names.length; i++) {
    const local = compose(pose.t[i], pose.q[i]);
    const p = rig.parent[i];
    out[i] = mMul(p < 0 ? rootM : out[p], local);
  }
  return out;
}

/**
 * Baked poses are stored at 1/256 unit (`BAKE_QUANTUM` Q12 units): an offset
 * 10 units out along a bone lands within 0.04 units, and the roster file is a
 * third the size (Plan 4 Task 10: 1.58 MB gzipped on the real skeletons; int32 Q12 was 3.4 MB on the invented one).
 */
const q = (v: number): number => Math.round((v * ONE) / BAKE_QUANTUM) * BAKE_QUANTUM;

/** A world matrix projected onto the side plane, quantised to the bake's precision (Q12 values). */
export function sideBonePose(m: Mat4): BonePose {
  return {
    tx: q(m[14]),
    ty: q(m[13]),
    m00: q(m[2]),
    m01: q(m[6]),
    m02: q(m[10]),
    m10: q(m[1]),
    m11: q(m[5]),
    m12: q(m[9]),
  };
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render3d/retarget`
Expected: PASS (9 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render3d/retarget/map.ts super-smash/src/render3d/retarget/retarget.ts super-smash/src/render3d/retarget/retarget.test.ts super-smash/src/render3d/bake/fk.ts super-smash/src/engine/acmd/bakeCodec.ts
git commit -m "super-smash: retarget the 2D pose clips onto SSBU skeletons" -m "Each 2D bone drives SSBU bones by turning about the side view's screen normal from a per-fighter calibration: spine, legs and feet keep SSBU's bind stance at the 2D rest pose, the T-posed arms hang first. Only rotations are driven, so limbs keep SSBU's lengths; spin pivots about the pelvis as resolve() does." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Forward kinematics and the side-plane projection the sim reads

`BonePose` (Plan 2) is a bone's transform in the fighter's facing-relative side plane: +x forward, +y up, origin at the feet, Q12. In SSBU model space forward is +Z and up is +Y, so the projection keeps the Z and Y rows of a bone's world matrix. Plan 2's `TOP_POSE` is exactly the identity matrix under this projection, which is why baked limbs and root-bone scripts share one frame. Poses are stored on a 1/256-unit grid (`BAKE_QUANTUM` = 16 Q12 units): 0.04 units at the end of a 10-unit offset, and it cuts the roster file to 1.58 MB gzipped on the real skeletons (Task 10; int32 Q12 was 3.4 MB on the invented test skeleton).

**Files:**
- Create: `super-smash/src/render3d/bake/fk.test.ts`

**Interfaces:** Consumes `TOP_POSE`, `bonePoint` (Plan 2 `src/engine/acmd/bones.ts`); produces nothing new (pins Task 3's `fk.ts`).

- [ ] **Step 1: Write the test** — `src/render3d/bake/fk.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BAKE_QUANTUM } from "@/engine/acmd/bakeCodec";
import { TOP_POSE, bonePoint } from "@/engine/acmd/bones";
import { ONE, fx } from "@/engine/fixed";
import { BASE_RIG } from "@/render/skeleton";
import { mTranslation } from "../math/rigid";
import { calibrate, restPose, retarget } from "../retarget/retarget";
import { buildRig } from "../skeleton/skeleton";
import { testSkeleton } from "../skeleton/testSkeleton";
import { IDENTITY_ROOT, sideBonePose, worldMatrices } from "./fk";

const rig = buildRig(testSkeleton());
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("forward kinematics and the side-plane projection", () => {
  it("projects the model's identity frame onto Plan 2's root pose: script Z forward, Y up", () => {
    expect(sideBonePose(IDENTITY)).toEqual(TOP_POSE);
  });

  it("lands a bone-local point where bonePoint says, so baked limbs and root-bone scripts share one frame", () => {
    const world = worldMatrices(rig, retarget(calibrate(rig, BASE_RIG), BASE_RIG, { thighR: 2.6 }, 0), IDENTITY_ROOT);
    const knee = world[rig.byLower.get("kneer")!];
    const pose = sideBonePose(knee);
    // A point 1.5 down the shin (KneeR's +X), in model space and through the baked pose.
    const lx = 1.5;
    const model = [knee[0] * lx + knee[12], knee[1] * lx + knee[13], knee[2] * lx + knee[14]];
    const p = bonePoint(pose, fx(lx), 0, 0);
    expect(Math.abs(p.x - Math.round(model[2] * ONE))).toBeLessThanOrEqual(2 * BAKE_QUANTUM);
    expect(Math.abs(p.y - Math.round(model[1] * ONE))).toBeLessThanOrEqual(2 * BAKE_QUANTUM);
  });

  it("stores every number on the bake's 1/256-unit grid", () => {
    const pose = sideBonePose(worldMatrices(rig, restPose(rig), IDENTITY_ROOT)[rig.byLower.get("head")!]);
    for (const v of Object.values(pose)) expect(v % BAKE_QUANTUM).toBe(0);
  });

  it("applies the root transform: clip offsets, squash and the fighter's size", () => {
    const head = rig.byLower.get("head")!;
    const plain = mTranslation(worldMatrices(rig, restPose(rig), IDENTITY_ROOT)[head]);
    const moved = mTranslation(worldMatrices(rig, restPose(rig), { forward: 2, up: 1, squashForward: 1, squashUp: 0.5, scale: 1.08 })[head]);
    expect(moved[1]).toBeCloseTo(1 + plain[1] * 1.08 * 0.5, 9);
    expect(moved[2]).toBeCloseTo(2 + plain[2] * 1.08, 9);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/render3d/bake/fk.test.ts`
Expected: PASS (4 tests). This task pins Task 3's projection against Plan 2's `bonePoint` contract; to see it bite, swap `m[10]` and `m[9]` in `sideBonePose` and watch "projects the model's identity frame onto Plan 2's root pose" fail, then restore.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add super-smash/src/render3d/bake/fk.test.ts
git commit -m "super-smash: pin the side-plane projection to Plan 2's bonePoint" -m "The identity model frame is TOP_POSE, a bone-local point lands where bonePoint says, poses sit on the 1/256-unit grid, and the root transform carries clip offsets, squash and the fighter's size." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fetch the models at a pinned commit, with SHA-256 checks; guard every manifest file

**Files:**
- Create: `super-smash/src/render3d/pipeline/manifest.ts`, `super-smash/src/render3d/pipeline/manifest.test.ts`, `super-smash/scripts/models/fetch.mjs`, `super-smash/scripts/models/manifest.json` (generated by Step 5)
- Modify: `super-smash/src/render3d/pipeline/noRippedAssets.test.ts` (Step 6: by name and by bytes), `super-smash/package.json` (scripts)

**Interfaces:**
- Produces (`pipeline/manifest.ts`, no runtime imports — `fetch.mjs` loads it by type stripping): `MODEL_SOURCE { project; projectId: 11666571; commit: "df76879171b064570b4e49a608c9f98211b33edb" }`, `FIGHTER_CODES` (`donkeyKong → "donkey"`, the rest identical), `MANIFEST_SCHEMA = 1`, `ManifestFile { fighter; path; bytes; sha256 }`, `ModelManifest`, `c00Dir(code)`, `wantedFile(name)`, `rawUrl(path)`, `treeUrl(code)`, `cachePath(file)` (`.model-cache/src/<fighterId>/<name>`), `parseManifest(json)`, `fileProblem(want, bytes, sha256)`.
- Produces (`noRippedAssets.test.ts`): `rippedAssets(tracked, manifest, size, hash): string[]` — a tracked path is ripped if it is under `.model-cache/` or `public/models/`, has a pipeline-only extension, has the basename of a manifest file, or has a manifest file's exact size *and* SHA-256 (a renamed copy).
- Scripts: `pnpm models:fetch` (verify the cache, download what is missing or stale), `pnpm models:fetch -- --update-manifest` (list upstream, download, rewrite `manifest.json`), `--only <fighterId>`. The script runs with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`: Node 26 otherwise warns on every run that `manifest.ts` "doesn't parse as CommonJS" (the package has no `"type"`, and adding one would change how every other script and config file loads).

- [ ] **Step 1: Write the failing test** — `src/render3d/pipeline/manifest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGHTER_IDS } from "@/fighters";
import { FIGHTER_CODES, MODEL_SOURCE, cachePath, fileProblem, parseManifest, rawUrl, wantedFile } from "./manifest";

describe("the model manifest", () => {
  it("names a code for every fighter in the roster", () => {
    expect(Object.keys(FIGHTER_CODES).sort()).toEqual([...FIGHTER_IDS].sort());
  });

  it("fetches the blend and colour maps, not normal/PRM/emissive maps", () => {
    expect(wantedFile("mario-c00.blend")).toBe(true);
    expect(wantedFile("skin_mario_001_col.png")).toBe(true);
    expect(wantedFile("eye_donkey_001.png")).toBe(true);
    expect(wantedFile("skin_mario_001_nor.png")).toBe(false);
    expect(wantedFile("skin_mario_001_prm.png")).toBe(false);
    expect(wantedFile("met_samus_001_emi.png")).toBe(false);
  });

  it("downloads from the pinned commit, never from master", () => {
    expect(rawUrl("fighter/mario/model/body/c00/mario-c00.blend")).toBe(
      `https://gitlab.com/${MODEL_SOURCE.project}/-/raw/${MODEL_SOURCE.commit}/fighter/mario/model/body/c00/mario-c00.blend`,
    );
  });

  it("keeps every cached file inside .model-cache/ (no path tricks from upstream names)", () => {
    expect(cachePath({ fighter: "mario", path: "fighter/mario/model/body/c00/mario-c00.blend" })).toBe(".model-cache/src/mario/mario-c00.blend");
    expect(() => cachePath({ fighter: "mario", path: "fighter/mario/model/body/c00/..blend" })).toThrow(/odd file name/);
  });

  it("says which file is wrong and how", () => {
    const want = { fighter: "mario", path: "a/b.blend", bytes: 10, sha256: "a".repeat(64) };
    expect(fileProblem(want, 10, "a".repeat(64))).toBeNull();
    expect(fileProblem(want, 9, "a".repeat(64))).toMatch(/9 bytes, manifest says 10/);
    expect(fileProblem(want, 10, "b".repeat(64))).toMatch(/sha256 bbbbbbbbbbbb/);
  });

  it("commits a manifest of hashes for all eight fighters, pinned to the same commit", () => {
    const m = parseManifest(JSON.parse(readFileSync(join(process.cwd(), "scripts", "models", "manifest.json"), "utf8")));
    expect(new Set(m.files.map((f) => f.fighter)).size).toBe(8);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/pipeline/manifest.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./manifest" from "src/render3d/pipeline/manifest.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/render3d/pipeline/manifest.ts`:

```ts
/**
 * Where the fighter models come from, and how a fetch proves it got them.
 *
 * Imported by `scripts/models/*.mjs` through Node's type stripping, so it has
 * no runtime imports, no enums and no parameter properties (as Plan 2's
 * `fighters/acmd/parse.ts`).
 *
 * The models are Worldblender's Blender re-exports of SSBU's own (README:
 * "near-straight imports from the original files"), pinned to one commit. They
 * are fetched into the git-ignored `.model-cache/`; only their SHA-256s are
 * committed (`scripts/models/manifest.json`), so the public repo never holds a
 * ripped file (spec §3.1) and a changed upstream file is refused, not used.
 */

export const MODEL_SOURCE = {
  project: "Worldblender/smash-ultimate-models-exported",
  projectId: 11666571,
  /** master as of 2026-10-24 (its last commit is 2021-11-01). */
  commit: "df76879171b064570b4e49a608c9f98211b33edb",
} as const;

/** Our fighter id → SSBU's fighter code (the folder under `fighter/`). */
export const FIGHTER_CODES: Readonly<Record<string, string>> = {
  mario: "mario",
  donkeyKong: "donkey",
  link: "link",
  samus: "samus",
  kirby: "kirby",
  fox: "fox",
  pikachu: "pikachu",
  marth: "marth",
};

export const MANIFEST_SCHEMA = 1;

export interface ManifestFile {
  readonly fighter: string;
  /** Path in the upstream repo. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ModelManifest {
  readonly schema: number;
  readonly source: typeof MODEL_SOURCE;
  readonly files: readonly ManifestFile[];
}

/** The c00 (default costume) body folder for a fighter code. */
export function c00Dir(code: string): string {
  return `fighter/${code}/model/body/c00`;
}

/**
 * The files a fighter needs: the .blend and every texture its materials can
 * reference. The .blend's materials use only colour maps (README "basic
 * materials"; verified on Mario's: ten `//*_col.png` image paths), so normal,
 * PRM and emissive maps are skipped. A few textures carry no suffix at all
 * (Donkey Kong's `eye_donkey_001.png`) and are kept.
 */
export function wantedFile(name: string): boolean {
  if (name.endsWith(".blend")) return true;
  return name.endsWith(".png") && !/_(nor|prm|emi)\.png$/.test(name);
}

export function rawUrl(path: string): string {
  return `https://gitlab.com/${MODEL_SOURCE.project}/-/raw/${MODEL_SOURCE.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function treeUrl(code: string): string {
  return `https://gitlab.com/api/v4/projects/${MODEL_SOURCE.projectId}/repository/tree?path=${encodeURIComponent(c00Dir(code))}&ref=${MODEL_SOURCE.commit}&per_page=100`;
}

/** Where a fetched file lives locally, relative to `super-smash/`. */
export function cachePath(file: Pick<ManifestFile, "fighter" | "path">): string {
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith(".")) throw new Error(`refusing odd file name "${name}"`);
  return `.model-cache/src/${file.fighter}/${name}`;
}

export function parseManifest(json: unknown): ModelManifest {
  const m = json as Partial<ModelManifest> | null;
  if (m === null || typeof m !== "object" || m.schema !== MANIFEST_SCHEMA) throw new Error("manifest: wrong schema");
  if (m.source?.commit !== MODEL_SOURCE.commit) throw new Error(`manifest: pinned to ${String(m.source?.commit)}, code pins ${MODEL_SOURCE.commit}`);
  if (!Array.isArray(m.files)) throw new Error("manifest: no files");
  for (const id of Object.keys(FIGHTER_CODES)) {
    if (!m.files.some((f) => f.fighter === id && f.path.endsWith(".blend"))) throw new Error(`manifest: no .blend for ${id}`);
  }
  for (const f of m.files) {
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`manifest: ${f.path} has no sha256`);
    if (!f.path.startsWith(c00Dir(FIGHTER_CODES[f.fighter] ?? "?") + "/")) throw new Error(`manifest: ${f.path} is outside ${f.fighter}'s c00 folder`);
    cachePath(f);
  }
  return m as ModelManifest;
}

/** Why a downloaded or cached file is not the one the manifest pins, or null if it is. */
export function fileProblem(want: ManifestFile, bytes: number, sha256: string): string | null {
  if (bytes !== want.bytes) return `${want.path}: ${bytes} bytes, manifest says ${want.bytes}`;
  if (sha256 !== want.sha256) return `${want.path}: sha256 ${sha256.slice(0, 12)}…, manifest says ${want.sha256.slice(0, 12)}…`;
  return null;
}
```

`scripts/models/fetch.mjs`:

```js
/**
 * Fetch the fighter models into the git-ignored `.model-cache/` (Plan 4).
 *
 *   node scripts/models/fetch.mjs                    # verify the cache, download what is missing
 *   node scripts/models/fetch.mjs --update-manifest  # list upstream, download, rewrite manifest.json
 *   node scripts/models/fetch.mjs --only mario       # one fighter
 *
 * Only `scripts/models/manifest.json` (paths, sizes, SHA-256s) is ever
 * committed. A file whose hash differs from the manifest is deleted and the run
 * fails: upstream changing under us is a reason to stop, not to proceed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  FIGHTER_CODES,
  MANIFEST_SCHEMA,
  MODEL_SOURCE,
  cachePath,
  fileProblem,
  parseManifest,
  rawUrl,
  treeUrl,
  wantedFile,
} from "../../src/render3d/pipeline/manifest.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const MANIFEST = join(ROOT, "scripts", "models", "manifest.json");
const argv = process.argv.slice(2);
const update = argv.includes("--update-manifest");
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1] : null;
if (only !== null && !(only in FIGHTER_CODES)) {
  console.error(`unknown fighter "${only}". Try one of: ${Object.keys(FIGHTER_CODES).join(", ")}`);
  process.exit(1);
}
const fighters = Object.keys(FIGHTER_CODES).filter((id) => only === null || id === only);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { redirect: "follow" });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 3 || res.status === 404) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function listUpstream(id) {
  const res = await fetch(treeUrl(FIGHTER_CODES[id]));
  if (!res.ok) throw new Error(`listing ${id}: HTTP ${res.status}`);
  const entries = await res.json();
  return entries.filter((e) => e.type === "blob" && wantedFile(e.name)).map((e) => e.path).sort();
}

/** Download to a temp name, check, then move into place: a killed run never leaves a half file. */
async function fetchTo(file, check) {
  const dest = join(ROOT, cachePath(file));
  mkdirSync(dirname(dest), { recursive: true });
  const buf = await download(rawUrl(file.path));
  const problem = check(buf);
  if (problem) throw new Error(problem);
  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
  return buf;
}

if (update) {
  const old = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { files: [] };
  const kept = (old.files ?? []).filter((f) => !fighters.includes(f.fighter));
  const files = [...kept];
  for (const id of fighters) {
    for (const path of await listUpstream(id)) {
      const buf = await fetchTo({ fighter: id, path }, () => null);
      files.push({ fighter: id, path, bytes: buf.length, sha256: sha256(buf) });
      console.log(`${id}  ${path.slice(path.lastIndexOf("/") + 1)}  ${buf.length} B`);
    }
  }
  files.sort((a, b) => a.fighter.localeCompare(b.fighter) || a.path.localeCompare(b.path));
  writeFileSync(MANIFEST, JSON.stringify({ schema: MANIFEST_SCHEMA, source: MODEL_SOURCE, files }, null, 2) + "\n");
  console.log(`manifest: ${files.length} files`);
  process.exit(0);
}

const manifest = parseManifest(JSON.parse(readFileSync(MANIFEST, "utf8")));
let fetched = 0;
let failed = 0;
for (const file of manifest.files.filter((f) => fighters.includes(f.fighter))) {
  const dest = join(ROOT, cachePath(file));
  if (existsSync(dest)) {
    const buf = readFileSync(dest);
    const problem = fileProblem(file, buf.length, sha256(buf));
    if (problem === null) continue;
    console.error(`stale: ${problem} — deleting and fetching again`);
    rmSync(dest);
  }
  try {
    await fetchTo(file, (buf) => fileProblem(file, buf.length, sha256(buf)));
    fetched++;
  } catch (e) {
    console.error(`FAILED ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}
console.log(`fetch: ${fetched} downloaded, ${failed} failed, cache in .model-cache/src/`);
process.exit(failed > 0 ? 1 : 0);
```

`package.json` — add to `scripts`:

```json
    "models:fetch": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/models/fetch.mjs",
```

- [ ] **Step 4: Run the test** — five of six pass; "commits a manifest of hashes for all eight fighters" fails with `ENOENT … scripts/models/manifest.json` until Step 5 writes it.

Run: `pnpm vitest run src/render3d/pipeline/manifest.test.ts`
Expected: 5 passed, 1 failed (`ENOENT: no such file or directory, open '…/scripts/models/manifest.json'`).

- [ ] **Step 5: Download the eight fighters and write the manifest.** This downloads **82,191,933 bytes (78.4 MiB) in 114 files** — eight `.blend` files of 4.3–10.0 MB and their colour maps — from GitLab into the git-ignored `.model-cache/src/`. It stays on this machine: nothing under `.model-cache/` is ever staged (Task 1's guard), and no gate runs between the download and Step 6.

Run: `pnpm models:fetch -- --update-manifest`
Expected: one line per file (`mario  mario-c00.blend  9190080 B` among them — verified on 2026-10-24), no `MODULE_TYPELESS_PACKAGE_JSON` warning, ending `manifest: 114 files`; `scripts/models/manifest.json` lists all eight fighters (Kirby 30 files, Marth 16, Fox 14, Link 13, Donkey Kong 12, Mario 11, Pikachu 9, Samus 9), each with exactly one `.blend`. Then:

Run: `pnpm models:fetch`
Expected: `fetch: 0 downloaded, 0 failed, cache in .model-cache/src/` (everything verified from cache).

Then prove the stale-file path once (verified in scratch on Mario): `printf x >> .model-cache/src/mario/alp_mario_002_col.png && pnpm models:fetch -- --only mario`
Expected: `stale: fighter/mario/model/body/c00/alp_mario_002_col.png: 879 bytes, manifest says 878 — deleting and fetching again`, then `fetch: 1 downloaded, 0 failed, cache in .model-cache/src/`.

- [ ] **Step 6: Widen the guard to every file the manifest lists.** Task 1's test catches pipeline formats and the two ignored folders; a texture copied into any other folder would pass it, and a name pattern (tried first) missed 17 of the 114 real names (`eye_donkey_001.png`, `tooth_donkey_002_col.png`, `fox_alp_001_col.png`, the seven `melee_eye_kirby_*`, `eyel_marth_b_col.png`, `eyer_marth_b_col.png`, the five `pikachu_facial_*`). Replace `src/render3d/pipeline/noRippedAssets.test.ts` with:

```ts
// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseManifest, type ModelManifest } from "./manifest";

/**
 * The public repo must never hold a ripped model or texture (spec §3.1): a DMCA
 * notice against one would take down every replica in Replicates. The fetched
 * files live in `.model-cache/`, the built glbs in `public/models/`; both are
 * git-ignored, and this test fails if any tracked or staged file is one of them.
 *
 * "One of them" is decided by the manifest, not by guessing at names: a file
 * is ripped if its name is one the manifest lists, or if its bytes hash to one
 * the manifest lists (a renamed copy), or if it is a format only the pipeline
 * makes (.blend, .glb, .gltf, .webp, .ktx2). A name pattern missed 17 of the
 * 114 real files (`eye_donkey_001.png`, `pikachu_facial_01_col.png`, …).
 */

const ROOT = process.cwd();
const PIPELINE_ONLY = /\.(blend|blend1|glb|gltf|webp|ktx2)$/i;

/** Tracked paths that are ripped assets, with why. `stat`/`hash` are injected so the rule is testable without real files. */
export function rippedAssets(
  tracked: readonly string[],
  manifest: ModelManifest,
  size: (path: string) => number,
  hash: (path: string) => string,
): string[] {
  const names = new Set(manifest.files.map((f) => basename(f.path).toLowerCase()));
  const bySize = new Map<number, Set<string>>();
  for (const f of manifest.files) bySize.set(f.bytes, (bySize.get(f.bytes) ?? new Set()).add(f.sha256));
  const out: string[] = [];
  for (const path of tracked) {
    if (path.startsWith(".model-cache/") || path.startsWith("public/models/")) out.push(`${path} (git-ignored output)`);
    else if (PIPELINE_ONLY.test(path)) out.push(`${path} (pipeline-only format)`);
    else if (names.has(basename(path).toLowerCase())) out.push(`${path} (manifest file name)`);
    else {
      // Only a file of exactly a manifest size can have a manifest hash.
      const shas = bySize.get(size(path));
      if (shas?.has(hash(path))) out.push(`${path} (manifest file bytes)`);
    }
  }
  return out;
}

const manifest = parseManifest(JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8")));

describe("the ripped-asset rule", () => {
  const sizes: Record<string, number> = { "docs/a.png": 1168, "docs/b.png": 1168, "src/x.ts": 10 };
  const shas: Record<string, string> = { "docs/a.png": manifest.files.find((f) => f.bytes === 1168)?.sha256 ?? "", "docs/b.png": "0".repeat(64), "src/x.ts": "1".repeat(64) };
  const run = (paths: string[]) => rippedAssets(paths, manifest, (p) => sizes[p] ?? 0, (p) => shas[p] ?? "");

  it("catches names the old pattern missed, renamed copies, and pipeline formats", () => {
    expect(run(["public/eye_donkey_001.png", "art/pikachu_facial_01_col.png"])).toHaveLength(2);
    expect(run(["docs/a.png"])).toEqual(["docs/a.png (manifest file bytes)"]);
    expect(run(["x/fighter.webp", "y/z.ktx2", "a.glb", "b.blend"])).toHaveLength(4);
  });

  it("passes ordinary files, even one the size of a texture", () => {
    expect(run(["docs/b.png", "src/x.ts", "scripts/models/manifest.json"])).toEqual([]);
  });
});

describe("no Nintendo-ripped asset is tracked", () => {
  it("ignores the model cache, the built models and Python bytecode", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
    for (const rule of ["/.model-cache/", "/public/models/", "*.blend", "__pycache__/"]) expect(ignore).toContain(rule);
    const check = (p: string) => execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: ROOT, stdio: "pipe" });
    expect(() => check(".model-cache/src/mario/mario-c00.blend")).not.toThrow();
    expect(() => check("public/models/mario.0123abcd.glb")).not.toThrow();
    expect(() => check("public/models/index.json")).not.toThrow();
    expect(() => check("scripts/models/__pycache__/x.pyc")).not.toThrow();
  });

  it("tracks and stages none of the manifest's files, by name or by bytes", () => {
    const tracked = execFileSync("git", ["ls-files", "--cached", "--", "."], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    const sha = (p: string) => createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex");
    const size = (p: string) => {
      try {
        return statSync(join(ROOT, p)).size;
      } catch {
        return -1; // staged for deletion
      }
    };
    expect(rippedAssets(tracked, manifest, size, sha)).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/render3d/pipeline`
Expected: PASS (manifest 6 tests, noRippedAssets 4 tests). The two "ripped-asset rule" tests are the ones that bite: they feed the rule a renamed copy (matched by size and SHA-256), two of the names the pattern missed, and the four pipeline formats. `git status --short` shows `scripts/models/manifest.json` but nothing under `.model-cache/`.

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 8: Commit** (hashes only — the guard test above proves no downloaded file is staged)

```bash
git add super-smash/src/render3d/pipeline/manifest.ts super-smash/src/render3d/pipeline/manifest.test.ts super-smash/src/render3d/pipeline/noRippedAssets.test.ts super-smash/scripts/models/fetch.mjs super-smash/scripts/models/manifest.json super-smash/package.json
git commit -m "super-smash: fetch the fighter models at a pinned commit, verified by SHA-256" -m "The .blend and colour maps for the eight fighters (114 files, 78 MiB) come from Worldblender's Blender re-exports at commit df768791 into the git-ignored .model-cache/. Only their paths, sizes and SHA-256s are committed; a changed or truncated file is deleted and refetched, never used. The never-commit guard now refuses any tracked file whose name, or whose size and SHA-256, is a manifest file's." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Read the skeletons out of the .blend files without Blender, and commit them

Everything the sim reads from a model — bone names, bind matrices, hurt capsules — comes from this task, and none of it needs Blender. `scripts/models/skeleton_from_blend.py` is a stdlib-only reader of Blender's file format (`struct` only; it never imports `bpy` and never evaluates anything in the file, which is downloaded data — run it isolated with `python3 -I -B`). A `.blend` is a header, then blocks, ending `ENDB`; its `DNA1` block describes every struct's fields, so the reader computes offsets rather than hard-coding them. It reads each `Bone`'s name, parent and `arm_mat`, the armature object's matrix (the importer's +90° turn about X, which `Z_UP_TO_Y_UP` undoes, giving SSBU model space: +Y up, +Z forward, +X the fighter's left), each mesh's vertex groups, vertices and weights, and the image names. Blender (Task 7) is then needed only to export the glbs, and Task 8 cross-checks its dump against this one.

Which meshes are the fighter is a decision written down per fighter, not a guess from names. `scripts/models/meshes.json` lists, for each of the eight, every mesh's name (without Blender's `.NNN` suffix) under `keep` or `drop`, written from the real files: the body, the neutral face and the open eyes stay; alternate expressions, blinks, talk/hurt/attack faces, low-poly duplicates (`body_c00_lowShape`), sheathed-sword copies (`kenb`, `tateb`, `tsuka`) and morph balls go. A mesh in neither list fails the reader. (A first filter that dropped any `<Fighter>_<Token>_VIS_O_OBJShape` whose token was not on a list of neutral faces dropped real parts on seven fighters: Donkey Kong's `donkey_FaceN`, Link's `link_ken` sword and `link_tate` shield, Fox's `fox_blaster`, Marth's `WeaponbladeM` blade.) Kept / listed: Mario 8/62, Donkey Kong 15/58, Link 13/55, Samus 24/25, Kirby 4/26, Fox 13/37, Pikachu 4/40, Marth 16/47.

Hurt capsules (UNVERIFIED — no public source lists SSBU's hurtboxes): each kept vertex belongs to the nearest listed hurt bone above the bone it is most weighted to (held items, swords, tails and `Throw` excluded); per hurt bone a capsule along its local +X whose rounded ends reach the 5th and 95th percentile of its vertices along the bone and whose radius covers three quarters of them; a part shorter than its own width is a sphere at its middle. Which bones carry capsules is `src/render3d/skeletons/hurtBones.json`, one table read by the reader, the sim's tests and the overlay: the humanoid default (`Head Bust Hip ShoulderL ArmL ShoulderR ArmR LegL KneeL LegR KneeR`), and Kirby's own, because his round body is weighted to `Body` (a child of `Head`) and his feet to `FootL/R` under `KneeL/R` — his `Head`, `Hip` and `LegL` own no vertices at all. The table also names each fighter's head capsule (Kirby's is `Body`), where Task 20's overlay hangs port tags.

**Files:**
- Create: `super-smash/scripts/models/skeleton_from_blend.py`, `super-smash/scripts/models/skeletons.mjs`, `super-smash/scripts/models/meshes.json`, `super-smash/src/render3d/skeletons/hurtBones.json`, `super-smash/src/render3d/skeletons/hurtBones.ts`, `super-smash/src/render3d/pipeline/dump.ts`, `super-smash/src/render3d/pipeline/dump.test.ts`, `super-smash/src/engine/acmd/scriptBones.ts`, `super-smash/src/render3d/bake/roster.ts` (only `referenceScriptBones` now; Task 10 adds `bakeRoster`), `super-smash/src/render3d/skeletons/skeletons.test.ts`, `super-smash/src/render3d/skeletons/missing.json`, `super-smash/src/render3d/skeletons/index.ts`, `super-smash/src/render3d/skeletons/{mario,donkeyKong,link,samus,kirby,fox,pikachu,marth}.json` (generated by Step 6)
- Modify: `super-smash/package.json` (scripts)

**Interfaces:**
- Produces (`pipeline/dump.ts`): `DUMP_SCHEMA = 1`, `DumpMesh { name; kept; verts; polys }`, `BoneDump extends SkeletonFile { code; blender; blend; space: "ssbu-model"; meshes; materials }`, `parseBoneDump(json): BoneDump` (refuses a Z-up or mirrored dump, no kept mesh, no materials, under 7 hurt capsules), `skeletonFromDump(dump, needed: Set<lowerName>): SkeletonFile`.
- Produces (`skeletons/hurtBones.ts`): `HurtBones { head; bones }`, `hurtBonesFor(fighterId): HurtBones`.
- Produces (`src/engine/acmd/scriptBones.ts`): `scriptBoneNames(commands): Set<string>` (lower case, loops included, `top` excluded).
- Produces (`src/render3d/bake/roster.ts`): `referenceScriptBones(fighterId): Set<string>`.
- Produces (`src/render3d/skeletons/index.ts`): `SKELETONS: Record<fighterId, SkeletonFile>`.
- Produces (git-ignored): `.model-cache/dumps/<fighterId>.sdna.json` (schema in `dump.ts`; `blender` is `"sdna-reader 1"`).
- Scripts: `pnpm models:skeletons` (`--only <id>`); `UPDATE_SKELETONS=1 pnpm vitest run src/render3d/skeletons/skeletons.test.ts`.

- [ ] **Step 1: Write the failing tests** — `src/render3d/pipeline/dump.test.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testSkeleton } from "../skeleton/testSkeleton";
import { DUMP_SCHEMA, parseBoneDump, skeletonFromDump, type BoneDump } from "./dump";

/** A dump shaped exactly as export_gltf.py writes it, on the invented skeleton. */
function dump(over: Partial<BoneDump> = {}): BoneDump {
  const s = testSkeleton("mario");
  return {
    schema: DUMP_SCHEMA,
    fighter: "mario",
    code: "mario",
    blender: "5.2.2",
    blend: "mario-c00.blend",
    space: "ssbu-model",
    bones: s.bones,
    hurt: s.hurt,
    meshes: [
      { name: "c00bodyShape", kept: true, verts: 2664, polys: 4124 },
      { name: "Mario_FaceN_VIS_O_OBJShape", kept: true, verts: 209, polys: 302 },
      { name: "Mario_Blink_VIS_O_OBJShape", kept: false, verts: 70, polys: 96 },
    ],
    materials: [{ name: "skin_mario_001", image: "skin_mario_001_col.png" }],
    ...over,
  } as BoneDump;
}

const moveBone = (d: BoneDump, name: string, x: number, y: number, z: number) =>
  d.bones.map((b) => (b.name === name ? { ...b, world: [...b.world.slice(0, 12), x, y, z, 1] } : b));

describe("the Blender spike's bone dump", () => {
  it("accepts the schema export_gltf.py writes", () => {
    expect(parseBoneDump(dump()).fighter).toBe("mario");
  });

  it("refuses a dump still in Blender's Z-up space (head not above the hips)", () => {
    const d = dump();
    expect(() => parseBoneDump({ ...d, bones: moveBone(d, "Head", 0, 0, 10) })).toThrow(/mario: up is not \+Y/);
  });

  it("refuses a mirrored dump (toes behind the ankles)", () => {
    const d = dump();
    expect(() => parseBoneDump({ ...d, bones: moveBone(d, "ToeL", 1.2, 0.8, -1.3) })).toThrow(/forward is not \+Z \(ToeL/);
  });

  it("refuses a dump that kept no mesh, has no materials or too few hurt capsules", () => {
    expect(() => parseBoneDump(dump({ meshes: [] }))).toThrow(/no mesh kept/);
    expect(() => parseBoneDump(dump({ materials: [] }))).toThrow(/no materials/);
    expect(() => parseBoneDump(dump({ hurt: dump().hurt.slice(0, 3) }))).toThrow(/only 3 hurt capsules/);
  });

  it("trims to the needed bones and their ancestors, rounded to five decimals", () => {
    const s = skeletonFromDump(dump(), new Set(["kneer", "head"]));
    expect(s.bones.map((b) => b.name)).toEqual(["Trans", "Rot", "Hip", "Waist", "Bust", "Neck", "Head", "LegC", "LegR", "KneeR"]);
    for (const b of s.bones) for (const v of b.world) expect(Math.round(v * 1e5) / 1e5).toBe(v);
  });
});

describe("the local dumps (when `pnpm models:skeletons` or `pnpm models` has run)", () => {
  const dir = join(process.cwd(), ".model-cache", "dumps");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const read = (f: string) => parseBoneDump(JSON.parse(readFileSync(join(dir, f), "utf8")));
  it.skipIf(files.length === 0)("all parse, so a bad export fails here before it reaches the bake", () => {
    for (const f of files) expect(read(f).fighter).toBe(f.replace(/(\.sdna)?\.json$/, ""));
  });

  // Blender (Task 8) and the stdlib reader (Task 6) read the same .blend; the
  // committed skeletons come from the reader, the glbs from Blender. They must agree.
  const pairs = files.filter((f) => f.endsWith(".sdna.json") && files.includes(f.replace(".sdna.json", ".json")));
  it.skipIf(pairs.length === 0)("Blender's dump and the SDNA reader's agree on every bone, kept mesh and hurt capsule", () => {
    for (const f of pairs) {
      const sdna = read(f);
      const blender = read(f.replace(".sdna.json", ".json"));
      const byName = new Map(blender.bones.map((b) => [b.name, b]));
      expect(sdna.bones.map((b) => b.name).sort(), sdna.fighter).toEqual(blender.bones.map((b) => b.name).sort());
      for (const b of sdna.bones) {
        const off = Math.max(...b.world.map((v, i) => Math.abs(v - byName.get(b.name)!.world[i])));
        expect(off, `${sdna.fighter} ${b.name}`).toBeLessThan(1e-4);
      }
      const kept = (d: BoneDump) => d.meshes.filter((m) => m.kept).map((m) => m.name).sort();
      expect(kept(sdna), sdna.fighter).toEqual(kept(blender));
      expect(sdna.hurt.map((h) => h.bone), sdna.fighter).toEqual(blender.hurt.map((h) => h.bone));
      sdna.hurt.forEach((h, i) => {
        const o = blender.hurt[i];
        expect(Math.max(Math.abs(h.x1 - o.x1), Math.abs(h.x2 - o.x2), Math.abs(h.r - o.r)), `${sdna.fighter} ${h.bone}`).toBeLessThan(1e-3);
      });
    }
  });
});
```

`src/render3d/skeletons/skeletons.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { getCharacterRig } from "@/render/chars";
import { BONE_NAMES } from "@/render/skeleton";
import { referenceScriptBones } from "../bake/roster";
import { parseBoneDump, skeletonFromDump } from "../pipeline/dump";
import { PIVOT_BONE, RETARGET, RETARGET_OVERRIDES } from "../retarget/map";
import { calibrate } from "../retarget/retarget";
import { buildRig, parseSkeletonFile } from "../skeleton/skeleton";
import { hurtBonesFor } from "./hurtBones";

/**
 * The committed skeletons (Plan 4 Task 6): trimmed from the SDNA reader's
 * dumps (`pnpm models:skeletons` → `.model-cache/dumps/<id>.sdna.json`, no
 * Blender) by
 *
 *   UPDATE_SKELETONS=1 pnpm vitest run src/render3d/skeletons/skeletons.test.ts
 *
 * and checked here on every run, with no model cache needed.
 */

const DIR = join(process.cwd(), "src", "render3d", "skeletons");
const DUMPS = join(process.cwd(), ".model-cache", "dumps");
/** Bones a reference script names that a fighter's skeleton does not have, with the reason. Starts empty. */
const MISSING: Readonly<Record<string, Readonly<Record<string, string>>>> = JSON.parse(readFileSync(join(DIR, "missing.json"), "utf8"));

function neededBones(fighterId: string): Set<string> {
  const out = new Set<string>([PIVOT_BONE.toLowerCase()]);
  for (const name of BONE_NAMES) {
    const drive = RETARGET_OVERRIDES[fighterId]?.[name] ?? RETARGET[name];
    for (const b of [...(drive?.bones ?? []), ...(drive?.tips ?? [])]) if (b !== null) out.add(b.toLowerCase());
  }
  for (const b of referenceScriptBones(fighterId)) out.add(b);
  for (const b of hurtBonesFor(fighterId).bones) out.add(b.toLowerCase());
  return out;
}

describe("the committed fighter skeletons", () => {
  if (process.env.UPDATE_SKELETONS === "1") {
    it("trims every SDNA dump in .model-cache/dumps/ into src/render3d/skeletons/", () => {
      for (const def of FIGHTERS) {
        const file = join(DUMPS, `${def.id}.sdna.json`);
        if (!existsSync(file)) throw new Error(`no dump for ${def.id}: run pnpm models:fetch && pnpm models:skeletons first`);
        const dump = parseBoneDump(JSON.parse(readFileSync(file, "utf8")));
        const skeleton = skeletonFromDump(dump, neededBones(def.id));
        writeFileSync(join(DIR, `${def.id}.json`), JSON.stringify(skeleton, null, 1) + "\n");
      }
    });
    return;
  }

  for (const def of FIGHTERS) {
    it(`${def.id}: calibrates against the retarget map (fails loudly naming a missing mapped bone)`, () => {
      const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(DIR, `${def.id}.json`), "utf8")));
      expect(skeleton.fighter).toBe(def.id);
      const cal = calibrate(buildRig(skeleton), getCharacterRig(def.id).bones);
      expect(cal.drives.length).toBeGreaterThanOrEqual(15);
    });

    it(`${def.id}: has every bone its published scripts hang hitboxes on, or says why not`, () => {
      const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(DIR, `${def.id}.json`), "utf8")));
      const have = new Set(skeleton.bones.map((b) => b.name.toLowerCase()));
      const missing = [...referenceScriptBones(def.id)].filter((b) => !have.has(b)).sort();
      expect(missing).toEqual(Object.keys(MISSING[def.id] ?? {}).sort());
    });

    it(`${def.id}: has a hurt capsule on every bone hurtBones.json lists, the head among them`, () => {
      const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(DIR, `${def.id}.json`), "utf8")));
      const { head, bones } = hurtBonesFor(def.id);
      expect(skeleton.hurt.map((h) => h.bone)).toEqual(bones);
      expect(bones).toContain(head);
      expect(skeleton.hurt.length).toBeGreaterThanOrEqual(7);
    });
  }
});
```

and `src/render3d/skeletons/missing.json`:

```json
{}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/render3d/pipeline/dump.test.ts src/render3d/skeletons/skeletons.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./dump" from "src/render3d/pipeline/dump.test.ts". Does the file exist?` and, from the node-environment skeleton test, `Error: Cannot find module '../bake/roster' imported from …/src/render3d/skeletons/skeletons.test.ts`.

- [ ] **Step 3: Implement** — `src/render3d/pipeline/dump.ts`:

````ts
/**
 * The bone dump's schema, written by `scripts/models/skeleton_from_blend.py`
 * (no Blender) and by `scripts/models/export_gltf.py` (Blender), and checked
 * here so a bad file fails before it reaches a skeleton or the bake.
 *
 * `.model-cache/dumps/<fighterId>.json` (Blender, Task 8) and
 * `.model-cache/dumps/<fighterId>.sdna.json` (`skeleton_from_blend.py`, no
 * Blender, Task 6 — the one the committed skeletons are trimmed from), schema 1:
 *
 * ```json
 * {
 *   "schema": 1, "fighter": "mario", "code": "mario", "blender": "5.2.2",
 *   "blend": "mario-c00.blend",
 *   "space": "ssbu-model",                 // +Y up, +Z the fighter's forward, +X their left
 *   "bones": [{ "name": "Trans", "parent": null, "world": [16 numbers, column-major] }, …],
 *   "meshes": [{ "name": "Mario_FaceN_VIS_O_OBJShape", "kept": true, "verts": 209, "polys": 302 }, …],
 *   "materials": [{ "name": "skin_mario_001", "image": "skin_mario_001_col.png" }, …],
 *   "hurt": [{ "bone": "Head", "x1": 0.4, "x2": 2.6, "r": 2.1 }, …]
 * }
 * ```
 *
 * Verified on all eight real .blend files (Plan 4 Task 6): limb bones' local +X
 * runs along the limb; the armature object is the importer's +90° X turn, so
 * `C · matrix_world · matrix_local` with C the Z-up→Y-up turn is the bone's
 * SSBU bind matrix; toes at +Z (forward). Mario: 98 bones from `Trans`, the hat
 * at y = 13.18.
 */

import { SKELETON_SCHEMA, parseSkeletonFile, trimSkeleton, type SkeletonFile } from "../skeleton/skeleton";

export const DUMP_SCHEMA = 1;

export interface DumpMesh {
  readonly name: string;
  /** Listed under `keep` in `scripts/models/meshes.json` (and parented to the armature). */
  readonly kept: boolean;
  readonly verts: number;
  readonly polys: number;
}

export interface BoneDump extends SkeletonFile {
  readonly code: string;
  readonly blender: string;
  readonly blend: string;
  readonly space: "ssbu-model";
  readonly meshes: readonly DumpMesh[];
  readonly materials: readonly { readonly name: string; readonly image: string }[];
}

function fail(fighter: string, why: string): never {
  throw new Error(`bone dump ${fighter}: ${why}`);
}

/**
 * Validate a dump, loudly. Besides the shape, checks the two facts every later
 * step leans on: up is +Y (the head is above the hips) and forward is +Z (the
 * toes are in front of the ankles) — a dump in Blender's Z-up space, or a
 * mirrored one, fails here rather than as hitboxes behind the fighter.
 */
export function parseBoneDump(json: unknown): BoneDump {
  const d = json as Partial<BoneDump> | null;
  const fighter = typeof d?.fighter === "string" ? d.fighter : "?";
  if (d === null || typeof d !== "object") fail(fighter, "not an object");
  if (d.schema !== DUMP_SCHEMA) fail(fighter, `schema ${String(d.schema)}, expected ${DUMP_SCHEMA}`);
  if (d.space !== "ssbu-model") fail(fighter, `space "${String(d.space)}", expected "ssbu-model"`);
  parseSkeletonFile({ schema: SKELETON_SCHEMA, fighter, bones: d.bones, hurt: d.hurt });
  const at = (name: string) => {
    const b = d.bones!.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return b === undefined ? null : [b.world[12], b.world[13], b.world[14]];
  };
  const head = at("Head");
  const hip = at("Hip");
  if (head === null || hip === null) fail(fighter, "no Head or Hip bone");
  if (!(head[1] > hip[1] && hip[1] > 0)) fail(fighter, `up is not +Y (Head y ${head[1]}, Hip y ${hip[1]})`);
  for (const side of ["L", "R"]) {
    const foot = at(`Foot${side}`);
    const toe = at(`Toe${side}`);
    if (foot !== null && toe !== null && !(toe[2] > foot[2])) fail(fighter, `forward is not +Z (Toe${side} z ${toe[2]} ≤ Foot${side} z ${foot[2]})`);
  }
  if (!Array.isArray(d.meshes) || !d.meshes.some((m) => m.kept)) fail(fighter, "no mesh kept");
  if (!Array.isArray(d.materials) || d.materials.length === 0) fail(fighter, "no materials");
  if (d.hurt!.length < 7) fail(fighter, `only ${d.hurt!.length} hurt capsules`);
  return d as BoneDump;
}

/** The committed skeleton: the bones `needed` names (lower case) and their ancestors, plus the hurt capsules. */
export function skeletonFromDump(dump: BoneDump, needed: ReadonlySet<string>): SkeletonFile {
  const trimmed = trimSkeleton({ schema: SKELETON_SCHEMA, fighter: dump.fighter, bones: dump.bones, hurt: dump.hurt }, (n) => needed.has(n));
  const round = (v: number) => Math.round(v * 1e5) / 1e5 + 0;
  return {
    ...trimmed,
    bones: trimmed.bones.map((b) => ({ name: b.name, parent: b.parent, world: b.world.map(round) })),
    hurt: trimmed.hurt.map((h) => ({ bone: h.bone, x1: round(h.x1), x2: round(h.x2), r: round(h.r) })),
  };
}
````

`src/render3d/skeletons/hurtBones.json`:

```json
{
  "//": "Bones each fighter's hurt capsules hang on, and which of them is the head the overlay anchors to (Plan 4). A vertex belongs to the nearest listed ancestor of the bone it is most weighted to (held items, swords, tails and Throw excluded). Kirby is weighted differently from the humanoids: his round body to Body (a child of Head), his feet to FootL/R and ToeL/R under KneeL/R, so he has one body capsule, two per arm and one per leg. UNVERIFIED: no public source lists SSBU's hurtboxes.",
  "default": {
    "head": "Head",
    "bones": [
      "Head",
      "Bust",
      "Hip",
      "ShoulderL",
      "ArmL",
      "ShoulderR",
      "ArmR",
      "LegL",
      "KneeL",
      "LegR",
      "KneeR"
    ]
  },
  "kirby": {
    "head": "Body",
    "bones": [
      "Body",
      "ShoulderL",
      "ArmL",
      "ShoulderR",
      "ArmR",
      "KneeL",
      "KneeR"
    ]
  }
}
```

`src/render3d/skeletons/hurtBones.ts`:

```ts
/**
 * Which bones carry each fighter's hurt capsules, and which of them is the
 * head (Plan 4). One table, read by both sides: `skeleton_from_blend.py` fits
 * a capsule per listed bone from the vertices weighted to it, and the overlay
 * anchors port tags and dizzy stars above the head capsule.
 */

import table from "./hurtBones.json";

export interface HurtBones {
  /** The bone whose capsule is the fighter's head (Kirby's is his whole body). */
  readonly head: string;
  readonly bones: readonly string[];
}

const TABLE = table as unknown as Readonly<Record<string, HurtBones>>;

export function hurtBonesFor(fighterId: string): HurtBones {
  return TABLE[fighterId] ?? TABLE.default;
}
```

`src/engine/acmd/scriptBones.ts`:

```ts
/** Every bone an ATTACK or CATCH in these commands hangs off (loops included, `top` excluded). */

import type { AcmdCommand } from "./types";

export function scriptBoneNames(commands: readonly AcmdCommand[]): Set<string> {
  const out = new Set<string>();
  for (const c of commands) {
    if (c.op === "attack" || c.op === "catch") out.add(c.params.bone);
    else if (c.op === "loop") for (const b of scriptBoneNames(c.body)) out.add(b);
  }
  out.delete("top");
  return out;
}
```

`src/render3d/bake/roster.ts` (first version — Task 10 adds `bakeRoster` below it):

```ts
/**
 * The whole roster's bake inputs (Plan 4). Task 10 adds `bakeRoster`.
 */

import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { REFERENCE_SCRIPTS } from "@/fighters/acmd";

/** Every bone any of a fighter's reference scripts names (lower case, `top` excluded). */
export function referenceScriptBones(fighterId: string): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(REFERENCE_SCRIPTS[fighterId]?.scripts ?? {})) {
    for (const b of scriptBoneNames(s.commands)) out.add(b);
  }
  return out;
}
```

`scripts/models/meshes.json` (every mesh in the eight files, by name; the counts above are with Blender's `.001` copies):

```json
{
  "//": "Which meshes of each fighter's c00 .blend are exported (Plan 4). Names without Blender's .NNN suffix; every mesh in the file must be listed in keep or drop, so a renamed or new mesh fails the export instead of silently appearing. Kept: the body, the neutral face, open eyes, and props in their battle position (Link's sword and shield in hand, Marth's drawn Falchion); dropped: alternative expressions, blinks, results-screen faces, low-detail copies, sheathed/stowed props, the Morph Ball. Read from the meshes listed in each .blend on 2026-10-24; UNVERIFIED by eye until the lab shows each fighter.",
  "mario": {
    "keep": [
      "Mario_Eye_VIS_O_OBJShape",
      "Mario_FaceNMClose_VIS_O_OBJShape",
      "Mario_FaceN_VIS_O_OBJShape",
      "Mario_Hathead_VIS_O_OBJShape",
      "c00bodyShape"
    ],
    "drop": [
      "Mario_Attack_VIS_O_OBJShape",
      "Mario_Blink_VIS_O_OBJShape",
      "Mario_Bound_VIS_O_OBJShape",
      "Mario_Capture_VIS_O_OBJShape",
      "Mario_Cliff_VIS_O_OBJShape",
      "Mario_Damageflyfront_VIS_O_OBJShape",
      "Mario_Down_VIS_O_OBJShape",
      "Mario_Escape_VIS_O_OBJShape",
      "Mario_FaceNMHalf_VIS_O_OBJShape",
      "Mario_FaceNMOpen_VIS_O_OBJShape",
      "Mario_Final_VIS_O_OBJShape",
      "Mario_Furafura_VIS_O_OBJShape",
      "Mario_Hair_VIS_O_OBJShape",
      "Mario_Halfblink1_VIS_O_OBJShape",
      "Mario_Halfblink2_VIS_O_OBJShape",
      "Mario_Halfblink3_VIS_O_OBJShape",
      "Mario_HeavyAttackOpen_VIS_O_OBJShape",
      "Mario_Heavyhit_VIS_O_OBJShape",
      "Mario_Heavyouch_VIS_O_OBJShape",
      "Mario_Nohat_VIS_O_OBJShape",
      "Mario_Ottotto_VIS_O_OBJShape",
      "Mario_OuchMClose_VIS_O_OBJShape",
      "Mario_OuchMHalf_VIS_O_OBJShape",
      "Mario_OuchMOpen_VIS_O_OBJShape",
      "Mario_Ouch_VIS_O_OBJShape",
      "Mario_PatternB_VIS_O_OBJShape",
      "Mario_PatternC_VIS_O_OBJShape",
      "Mario_Result_VIS_O_OBJShape",
      "Mario_Sorori_VIS_O_OBJShape",
      "Mario_TalkMClose_VIS_O_OBJShape",
      "Mario_TalkMHalf_VIS_O_OBJShape",
      "Mario_TalkMOpen_VIS_O_OBJShape",
      "Mario_Talk_VIS_O_OBJShape"
    ]
  },
  "donkeyKong": {
    "keep": [
      "GamemodelShape",
      "donkey_Eye_VIS_O_OBJShape",
      "donkey_FaceN_VIS_O_OBJShape",
      "donkey_Larm_O_OBJ_O_SORTEACHNODEShape",
      "donkey_Lleg_O_OBJ_O_SORTEACHNODEShape",
      "donkey_Rarm_O_OBJ_O_SORTEACHNODEShape1",
      "donkey_Rleg_O_OBJ_O_SORTEACHNODEShape",
      "donkey_bodyL_O_OBJ_O_SORTEACHNODEShape",
      "donkey_bodyR_O_OBJ_O_SORTEACHNODEShape",
      "head_O_OBJShape",
      "senaka_O_OBJShape",
      "ura_O_OBJShape"
    ],
    "drop": [
      "donkey_Attack2_VIS_O_OBJShape",
      "donkey_Attack3_VIS_O_OBJShape",
      "donkey_Attack_VIS_O_OBJShape",
      "donkey_Blink_VIS_O_OBJShape",
      "donkey_Capture_VIS_O_OBJShape",
      "donkey_Catch_VIS_O_OBJShape",
      "donkey_Cliff_VIS_O_OBJShape",
      "donkey_Down_VIS_O_OBJShape",
      "donkey_Escape_VIS_O_OBJShape",
      "donkey_FaceUP1_VIS_O_OBJShape",
      "donkey_FaceUP2_VIS_O_OBJShape",
      "donkey_FaceUP3_VIS_O_OBJShape",
      "donkey_FaceUP4_VIS_O_OBJShape",
      "donkey_FaceUP5_VIS_O_OBJShape",
      "donkey_FaceUP6_VIS_O_OBJShape",
      "donkey_FaceUP7_VIS_O_OBJShape",
      "donkey_FaceUP8_VIS_O_OBJShape",
      "donkey_Fall_VIS_O_OBJShape",
      "donkey_Furafura_VIS_O_OBJShape",
      "donkey_Halfblink1_VIS_O_OBJShape",
      "donkey_Halfblink2_VIS_O_OBJShape",
      "donkey_Halfblink3_VIS_O_OBJShape",
      "donkey_HeavyAttack_VIS_O_OBJShape",
      "donkey_HeavyOuch_VIS_O_OBJShape",
      "donkey_Ottotto_VIS_O_OBJShape",
      "donkey_Ouch_VIS_O_OBJShape",
      "donkey_PatternA_VIS_O_OBJShape",
      "donkey_Result_FaceUp_VIS_O_OBJShape",
      "donkey_Result_Mouth_VIS_O_OBJShape",
      "donkey_Stuckouteye1_VIS_O_OBJShape",
      "donkey_Stuckouteye2_VIS_O_OBJShape",
      "donkey_Talk_VIS_O_OBJShape"
    ]
  },
  "link": {
    "keep": [
      "GamemodelShape",
      "body_c00_highShape",
      "link_Eye_VIS_O_OBJShape",
      "link_FaceN_Mouth_VIS_O_OBJShape",
      "link_Openblink_VIS_O_OBJShape",
      "link_ken_VIS_O_OBJShape",
      "link_sayatuka_VIS_O_OBJShape",
      "link_tate_VIS_O_OBJShape"
    ],
    "drop": [
      "body_c00_lowShape",
      "link_Blink_Down_VIS_O_OBJShape",
      "link_Blink_Escape_VIS_O_OBJShape",
      "link_Blink_Furafura_VIS_O_OBJShape",
      "link_Blink_HeavyAttack_VIS_O_OBJShape",
      "link_Blink_HeavyHit_VIS_O_OBJShape",
      "link_Blink_HeavyOuth_VIS_O_OBJShape",
      "link_Blink_Ottotto_VIS_O_OBJShape",
      "link_Blink_Outh_VIS_O_OBJShape",
      "link_Blink_Result_VIS_O_OBJShape",
      "link_Blink_Talk_VIS_O_OBJShape",
      "link_Blink_VIS_O_OBJShape",
      "link_Harfblink_VIS_O_OBJShape",
      "link_Mouth_Attack_VIS_O_OBJShape",
      "link_Mouth_Capture_VIS_O_OBJShape",
      "link_Mouth_Down_VIS_O_OBJShape",
      "link_Mouth_Escape_VIS_O_OBJShape",
      "link_Mouth_Furafura_VIS_O_OBJShape",
      "link_Mouth_HeavyAttack_VIS_O_OBJShape",
      "link_Mouth_HeavyOuth_VIS_O_OBJShape",
      "link_Mouth_Hot_VIS_O_OBJShape",
      "link_Mouth_Outh_VIS_O_OBJShape",
      "link_Mouth_Talk_VIS_O_OBJShape",
      "link_Result_Mouth_VIS_O_OBJShape",
      "link_kenb_VIS_O_OBJShape",
      "link_tateb_VIS_O_OBJShape"
    ]
  },
  "samus": {
    "keep": [
      "arm_cannon4_VIS_O_OBJShape",
      "arm_l1_O_OBJShape",
      "arm_l2_O_OBJShape",
      "arm_l3_O_OBJShape",
      "arm_r1_O_OBJShape",
      "arm_r2_O_OBJShape",
      "bust2_O_OBJShape",
      "helmet3_O_OBJShape",
      "knee_L_O_OBJShape",
      "knee_R_O_OBJShape",
      "leg_L_O_OBJShape",
      "leg_R_O_OBJShape",
      "pad_inner1_O_OBJShape",
      "pad_inner4_O_OBJShape",
      "samus_body_VIS_O_OBJShape",
      "samus_eye_NORMAL_VIS_O_OBJShape",
      "shourder_pad_L_O_OBJShape",
      "shourder_pad_R_O_OBJShape"
    ],
    "drop": [
      "samus_ball_VIS_O_OBJShape"
    ]
  },
  "kirby": {
    "keep": [
      "Kirby_Armfoot_VIS_O_OBJShape",
      "Kirby_Eye1_VIS_O_OBJShape",
      "Kirby_FaceN_VIS_O_OBJShape"
    ],
    "drop": [
      "Kirby_Attack_VIS_O_OBJShape",
      "Kirby_Blink_VIS_O_OBJShape",
      "Kirby_Bodybig2_VIS_O_OBJShape",
      "Kirby_Bodybig_VIS_O_OBJShape",
      "Kirby_DamageFlyFront_VIS_O_OBJShape",
      "Kirby_Eye2_VIS_O_OBJShape",
      "Kirby_Eye3_VIS_O_OBJShape",
      "Kirby_Eye4_VIS_O_OBJShape",
      "Kirby_Furafura_VIS_O_OBJShape",
      "Kirby_Halfblink1_VIS_O_OBJShape",
      "Kirby_Halfblink2_VIS_O_OBJShape",
      "Kirby_HeavyOuch_VIS_O_OBJShape",
      "Kirby_Ouch_VIS_O_OBJShape",
      "Kirby_PatternA_VIS_O_OBJShape",
      "Kirby_PatternB_VIS_O_OBJShape",
      "Kirby_Sorori_VIS_O_OBJShape",
      "Kirby_StepPose_VIS_O_OBJShape",
      "Kirby_Talk_VIS_O_OBJShape"
    ]
  },
  "fox": {
    "keep": [
      "Fox_FaceN_mayu_VIS_O_OBJShape",
      "Fox_FaceN_mouth_VIS_O_OBJShape",
      "Fox_normal_eye_VIS_O_OBJShape",
      "GamemodelShape",
      "fox_blaster_VIS_O_OBJShape",
      "groupShape14",
      "groupShape32",
      "scouter1Shape"
    ],
    "drop": [
      "Fox_Appeal_mayu_VIS_O_OBJShape",
      "Fox_Appeal_mouth_VIS_O_OBJShape",
      "Fox_Attack_mayu_VIS_O_OBJShape",
      "Fox_Attack_mouth_VIS_O_OBJShape",
      "Fox_Blink_mayu_VIS_O_OBJShape",
      "Fox_Capture_mayu_VIS_O_OBJShape",
      "Fox_Catch_mouth_VIS_O_OBJShape",
      "Fox_Escape_mouth_VIS_O_OBJShape",
      "Fox_Furafura_mayu_VIS_O_OBJShape",
      "Fox_Halfblink_mayu_VIS_O_OBJShape",
      "Fox_Heavyattack_mouth_VIS_O_OBJShape",
      "Fox_Heavyhit_mouth_VIS_O_OBJShape",
      "Fox_Heavyouch_mayu_VIS_O_OBJShape",
      "Fox_Heavyouch_mouth_VIS_O_OBJShape",
      "Fox_Hot_mouth_VIS_O_OBJShape",
      "Fox_Ottotto_mouth_VIS_O_OBJShape",
      "Fox_Ouch_mayu_VIS_O_OBJShape",
      "Fox_Ouch_mouth_VIS_O_OBJShape",
      "Fox_Result_mouth_VIS_O_OBJShape",
      "Fox_Talk_mayu_VIS_O_OBJShape",
      "Fox_Talk_mouth_VIS_O_OBJShape",
      "Fox_big_eye_VIS_O_OBJShape"
    ]
  },
  "pikachu": {
    "keep": [
      "Body_VIS_O_OBJShape",
      "Pikachu_LEye_VIS_O_OBJShape",
      "Pikachu_Mouth_VIS_O_OBJShape",
      "Pikachu_REye_VIS_O_OBJShape"
    ],
    "drop": [
      "CameraHit_VIS_O_OBJShape",
      "Pikachu_LEye_AngerFLIP_VIS_O_OBJShape",
      "Pikachu_LEye_Anger_VIS_O_OBJShape",
      "Pikachu_LEye_Blink_VIS_O_OBJShape",
      "Pikachu_LEye_Down_VIS_O_OBJShape",
      "Pikachu_LEye_Guru_VIS_O_OBJShape",
      "Pikachu_LEye_Halfblink1_VIS_O_OBJShape",
      "Pikachu_LEye_Halfblink2_VIS_O_OBJShape",
      "Pikachu_LEye_OuchFLIP_VIS_O_OBJShape",
      "Pikachu_LEye_Ouch_VIS_O_OBJShape",
      "Pikachu_Mouth_Anger_VIS_O_OBJShape",
      "Pikachu_Mouth_Down_VIS_O_OBJShape",
      "Pikachu_Mouth_Downb_VIS_O_OBJShape",
      "Pikachu_Mouth_He_VIS_O_OBJShape",
      "Pikachu_Mouth_HeavyOuch_VIS_O_OBJShape",
      "Pikachu_Mouth_Ho_VIS_O_OBJShape",
      "Pikachu_Mouth_Ouch_VIS_O_OBJShape",
      "Pikachu_Mouth_Talk_VIS_O_OBJShape",
      "Pikachu_Mouth_TeethFLIP_VIS_O_OBJShape",
      "Pikachu_Mouth_Teeth_VIS_O_OBJShape",
      "Pikachu_Mouth_VoiceA_VIS_O_OBJShape",
      "Pikachu_Mouth_Wa_VIS_O_OBJShape",
      "Pikachu_Mouth_result_VIS_O_OBJShape",
      "Pikachu_REye_AngerFLIP_VIS_O_OBJShape",
      "Pikachu_REye_Anger_VIS_O_OBJShape",
      "Pikachu_REye_Blink_VIS_O_OBJShape",
      "Pikachu_REye_Down_VIS_O_OBJShape",
      "Pikachu_REye_Guru_VIS_O_OBJShape",
      "Pikachu_REye_Halfblink1_VIS_O_OBJShape",
      "Pikachu_REye_Halfblink2_VIS_O_OBJShape",
      "Pikachu_REye_OuchFLIP_VIS_O_OBJShape",
      "Pikachu_REye_Ouch_VIS_O_OBJShape",
      "Pikachu_REye_OuchbFLIP_VIS_O_OBJShape",
      "Pikachu_REye_Ouchb_VIS_O_OBJShape"
    ]
  },
  "marth": {
    "keep": [
      "GamemodelShape",
      "Marth_Brow1_VIS_O_OBJShape",
      "Marth_FaceN_VIS_O_OBJShape",
      "SayaM_O_OBJShape",
      "WeaponbladeM_VIS_O_OBJShape",
      "WeapongripM_VIS_O_OBJShape",
      "hair_groupShape",
      "marth_eye_VIS_O_OBJShape"
    ],
    "drop": [
      "Marth_Blink_VIS_O_OBJShape",
      "Marth_Brow_HeavyAttack_VIS_O_OBJShape",
      "Marth_Brow_HeavyOuch_VIS_O_OBJShape",
      "Marth_Brow_Ottotto_VIS_O_OBJShape",
      "Marth_Brow_Ouch_VIS_O_OBJShape",
      "Marth_Brow_Talk_VIS_O_OBJShape",
      "Marth_Capture_VIS_O_OBJShape",
      "Marth_Escape_VIS_O_OBJShape",
      "Marth_Halfblink1_VIS_O_OBJShape",
      "Marth_HeavyAttack_VIS_O_OBJShape",
      "Marth_HeavyOuch_VIS_O_OBJShape",
      "Marth_Ouch_VIS_O_OBJShape",
      "Marth_PatternA_VIS_O_OBJShape",
      "Marth_Result_VIS_O_OBJShape",
      "Marth_Talk_VIS_O_OBJShape",
      "tsuka_VIS_O_OBJShape"
    ]
  }
}
```

`scripts/models/skeleton_from_blend.py`:

```python
"""
Read a fighter's bones, meshes and vertex weights straight out of its .blend —
no Blender — and write the bone dump the committed skeleton is trimmed from.

    python3 -I -B scripts/models/skeleton_from_blend.py <blend> --fighter mario --code mario \
        --meshes scripts/models/meshes.json --hurt src/render3d/skeletons/hurtBones.json --out .model-cache/dumps/mario.sdna.json

Plan 4. Blender is needed only to export the glbs; the numbers the sim reads
(bone names, bind matrices, hurt capsules) come from this reader, so the build
and every test run without Blender (Plan 4 Task 6), and Task 8's Blender dump is
cross-checked against this one (`dump.test.ts`).

A .blend is downloaded data. This script only parses its bytes with `struct`:
it never imports `bpy`, never evaluates anything stored in the file, and refuses
anything that is not a little-endian 64-bit Blender 2.8x+ file. Run it with
`python3 -I -B` (isolated: no user site, no cwd on the path; no bytecode).

The file format: a 12-byte header, then blocks (4-byte code, int32 size,
uint64 old pointer, int32 SDNA index, int32 count, data), ending with ENDB; the
DNA1 block describes every struct's fields, so offsets are computed, not
hard-coded. Bones carry `arm_mat` (bind matrix in armature space); the armature
object's `obmat` is the importer's +90 degree turn about X; Z_UP_TO_Y_UP undoes
it, giving SSBU model space (+Y up, +Z forward), exactly as export_gltf.py does.

Schema of the output: src/render3d/pipeline/dump.ts (`blender` is "sdna-reader 1").
"""

import json
import math
import re
import struct
import sys

READER = "sdna-reader 1"
SUFFIX = re.compile(r"\.\d+$")
NOT_BODY = re.compile(r"^(Have|Sword|Tail|Throw)", re.IGNORECASE)
# (x, y, z) -> (x, z, -y), column-major
Z_UP_TO_Y_UP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]


def fail(fighter, why):
    print(f"skeleton_from_blend {fighter}: {why}", file=sys.stderr)
    sys.exit(1)


def args(argv):
    out = {}
    rest = argv[1:]
    out["blend"] = rest[0]
    for i in range(1, len(rest), 2):
        out[rest[i].lstrip("-")] = rest[i + 1]
    for k in ("fighter", "code", "meshes", "hurt", "out"):
        if k not in out:
            fail(out.get("fighter", "?"), f"missing --{k}")
    return out


def mm(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def xf(m, v):
    return [m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] for r in range(3)]


def inv_rigid(m):
    o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]
    for r in range(3):
        o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14])
    return o


class Blend:
    """The blocks and the SDNA of one .blend, read-only."""

    def __init__(self, fighter, data):
        self.fighter = fighter
        self.data = data
        if data[:7] != b"BLENDER" or data[7:8] != b"-" or data[8:9] != b"v":
            fail(fighter, "not a 64-bit little-endian .blend")
        self.blocks = []
        off = 12
        while off + 24 <= len(data):
            code = data[off:off + 4]
            size, = struct.unpack_from("<i", data, off + 4)
            old, = struct.unpack_from("<Q", data, off + 8)
            sdna, count = struct.unpack_from("<ii", data, off + 16)
            if size < 0 or off + 24 + size > len(data):
                fail(fighter, f"block at {off} runs past the end of the file")
            self.blocks.append((code, size, old, sdna, count, off + 24))
            off += 24 + size
            if code == b"ENDB":
                break
        self.by_old = {b[2]: b for b in self.blocks}
        self._sdna()

    def _sdna(self):
        data = self.data
        dna = [b for b in self.blocks if b[0] == b"DNA1"]
        if len(dna) != 1:
            fail(self.fighter, "no DNA1 block")
        p = dna[0][5]

        def align(x):
            return (x + 3) & ~3

        def tag(name):
            nonlocal p
            if data[p:p + 4] != name:
                fail(self.fighter, f"SDNA: expected {name!r}")
            p += 4

        def strings():
            nonlocal p
            n, = struct.unpack_from("<i", data, p)
            p += 4
            out = []
            for _ in range(n):
                e = data.index(b"\0", p)
                out.append(data[p:e].decode("latin1"))
                p = e + 1
            return out

        tag(b"SDNA")
        tag(b"NAME")
        names = strings()
        p = align(p)
        tag(b"TYPE")
        types = strings()
        p = align(p)
        tag(b"TLEN")
        tlen = list(struct.unpack_from("<%dh" % len(types), data, p))
        p += 2 * len(types)
        p = align(p)
        tag(b"STRC")
        n, = struct.unpack_from("<i", data, p)
        p += 4
        self.structs = []
        for _ in range(n):
            t, nf = struct.unpack_from("<hh", data, p)
            p += 4
            fields = []
            for _ in range(nf):
                ft, fn = struct.unpack_from("<hh", data, p)
                p += 4
                fields.append((types[ft], names[fn]))
            self.structs.append((types[t], fields))
        self.types = types
        self.tlen = tlen
        self.sidx = {s[0]: i for i, s in enumerate(self.structs)}

    def size_of(self, struct_name):
        return self.tlen[self.types.index(struct_name)]

    def layout(self, struct_name):
        out = {}
        o = 0
        for t, f in self.structs[self.sidx[struct_name]][1]:
            key = f.split("[")[0].lstrip("*").replace("(*", "").replace(")()", "")
            size = 8 if (f.startswith("*") or f.startswith("(*")) else self.tlen[self.types.index(t)]
            for d in re.findall(r"\[(\d+)\]", f):
                size *= int(d)
            out[key] = o
            o += size
        return out

    def read(self, base, offset, fmt):
        return struct.unpack_from(fmt, self.data, base + offset)

    def cstr(self, base, offset, n):
        o = base + offset
        return self.data[o:o + n].split(b"\0")[0].decode("latin1")


def main():
    a = args(sys.argv)
    fighter = a["fighter"]
    with open(a["blend"], "rb") as f:
        blend = Blend(fighter, f.read())
    with open(a["meshes"]) as f:
        mesh_rules = json.load(f).get(fighter)
    if mesh_rules is None:
        fail(fighter, f"no entry in {a['meshes']}")
    with open(a["hurt"]) as f:
        hurt_table = json.load(f)
    hurt_entry = hurt_table.get(fighter, hurt_table["default"])
    hurt_bones = hurt_entry["bones"]
    if hurt_entry["head"] not in hurt_bones:
        fail(fighter, f"head bone {hurt_entry['head']} is not one of its hurt bones")

    bone_l = blend.layout("Bone")
    obj_l = blend.layout("Object")
    id_l = blend.layout("ID")
    mesh_l = blend.layout("Mesh")
    mvert_l = blend.layout("MVert")
    dvert_l = blend.layout("MDeformVert")
    dw_l = blend.layout("MDeformWeight")
    dg_l = blend.layout("bDeformGroup")
    T = blend.size_of

    # Bones: name, parent, bind matrix (armature space).
    raw_bones = []
    for b in blend.blocks:
        if b[0] != b"DATA" or blend.structs[b[3]][0] != "Bone":
            continue
        for i in range(b[4]):
            base = b[5] + i * T("Bone")
            raw_bones.append({
                "name": blend.cstr(base, bone_l["name"], 64),
                "ptr": b[2] + i * T("Bone"),
                "parent_ptr": blend.read(base, bone_l["parent"], "<Q")[0],
                "arm": list(blend.read(base, bone_l["arm_mat"], "<16f")),
            })
    name_of = {b["ptr"]: b["name"] for b in raw_bones}

    # Objects: the armature, and meshes with their vertex groups.
    objects = {}
    for b in blend.blocks:
        if b[0][:2] != b"OB":
            continue
        base = b[5]
        name = blend.cstr(base, obj_l["id"] + id_l["name"], 66)[2:]
        groups = []
        p = blend.read(base, obj_l["defbase"], "<Q")[0]
        while p:
            gb = blend.by_old.get(p)
            if gb is None:
                fail(fighter, f"object {name}: dangling vertex-group pointer")
            groups.append(blend.cstr(gb[5], dg_l["name"], 64))
            p = blend.read(gb[5], dg_l["next"], "<Q")[0]
        objects[b[2]] = {
            "name": name,
            "obmat": list(blend.read(base, obj_l["obmat"], "<16f")),
            "parent": blend.read(base, obj_l["parent"], "<Q")[0],
            "data": blend.read(base, obj_l["data"], "<Q")[0],
            "groups": groups,
        }
    armatures = [(k, o) for k, o in objects.items() if blend.by_old.get(o["data"]) and blend.by_old[o["data"]][0][:2] == b"AR"]
    if len(armatures) != 1:
        fail(fighter, f"expected one armature, found {len(armatures)}")
    arm_ptr, arm = armatures[0]

    world = {}
    bones = []
    for b in raw_bones:
        w = mm(Z_UP_TO_Y_UP, mm(arm["obmat"], b["arm"]))
        world[b["name"]] = w
        bones.append({"name": b["name"], "parent": name_of.get(b["parent_ptr"]), "world": [round(v, 6) for v in w]})
    parent_of = {b["name"]: b["parent"] for b in bones}
    missing = [h for h in hurt_bones if h not in world]
    if missing:
        fail(fighter, f"hurt bones {missing} are not in the skeleton; fix src/render3d/skeletons/hurtBones.json")

    # Which hurt capsule each bone's vertices belong to.
    owner = {}
    for n in parent_of:
        chain, at = [], n
        while at is not None:
            chain.append(at)
            at = parent_of[at]
        owner[n] = None if any(NOT_BODY.match(c) for c in chain) else next((c for c in chain if c in hurt_bones), None)

    listed = set(mesh_rules["keep"]) | set(mesh_rules["drop"])
    meshes = []
    points = {h: [] for h in hurt_bones}
    inverse = {h: inv_rigid(world[h]) for h in hurt_bones}
    for o in objects.values():
        mb = blend.by_old.get(o["data"])
        if mb is None or mb[0][:2] != b"ME":
            continue
        base_name = SUFFIX.sub("", o["name"])
        if base_name not in listed:
            fail(fighter, f"mesh {o['name']} is in neither keep nor drop of scripts/models/meshes.json")
        kept = o["parent"] == arm_ptr and base_name in mesh_rules["keep"]
        totvert = blend.read(mb[5], mesh_l["totvert"], "<i")[0]
        totpoly = blend.read(mb[5], mesh_l["totpoly"], "<i")[0]
        meshes.append({"name": o["name"], "kept": kept, "verts": totvert, "polys": totpoly})
        if not kept:
            continue
        vb = blend.by_old.get(blend.read(mb[5], mesh_l["mvert"], "<Q")[0])
        db = blend.by_old.get(blend.read(mb[5], mesh_l["dvert"], "<Q")[0])
        if vb is None or db is None:
            continue
        to_model = mm(Z_UP_TO_Y_UP, o["obmat"])
        for i in range(totvert):
            dbase = db[5] + i * T("MDeformVert")
            dw = blend.read(dbase, dvert_l["dw"], "<Q")[0]
            n = blend.read(dbase, dvert_l["totweight"], "<i")[0]
            if not dw or n <= 0:
                continue
            wb = blend.by_old.get(dw)
            if wb is None:
                continue
            best = max(
                ((blend.read(wb[5] + k * T("MDeformWeight"), dw_l["def_nr"], "<i")[0],
                  blend.read(wb[5] + k * T("MDeformWeight"), dw_l["weight"], "<f")[0]) for k in range(n)),
                key=lambda e: e[1],
            )
            if best[0] < 0 or best[0] >= len(o["groups"]):
                continue
            target = owner.get(o["groups"][best[0]])
            if target is None:
                continue
            co = struct.unpack_from("<3f", blend.data, vb[5] + i * T("MVert") + mvert_l["co"])
            points[target].append(xf(inverse[target], xf(to_model, co)))

    hurt = []
    for h in hurt_bones:
        pts = points[h]
        if len(pts) < 8:
            fail(fighter, f"hurt bone {h} owns only {len(pts)} kept vertices")
        xs = sorted(q[0] for q in pts)
        rs = sorted(math.hypot(q[1], q[2]) for q in pts)

        def pick(arr, q):
            return arr[min(len(arr) - 1, int(q * len(arr)))]

        # A capsule whose rounded ends reach the 5th and 95th percentile along
        # the bone and whose radius covers three quarters of the vertices
        # around it; a part shorter than its own width is a sphere at its middle.
        r = pick(rs, 0.75)
        lo, hi = pick(xs, 0.05), pick(xs, 0.95)
        x1, x2 = lo + r, hi - r
        if x1 > x2:
            x1 = x2 = (lo + hi) / 2
        hurt.append({"bone": h, "x1": round(x1, 5), "x2": round(x2, 5), "r": round(r, 5)})

    images = sorted({blend.cstr(b[5], blend.layout("Image")["id"] + id_l["name"], 66)[2:] for b in blend.blocks if b[0][:2] == b"IM"})
    dump = {
        "schema": 1,
        "fighter": fighter,
        "code": a["code"],
        "blender": READER,
        "blend": a["blend"].replace("\\", "/").split("/")[-1],
        "space": "ssbu-model",
        "bones": bones,
        "meshes": meshes,
        "materials": [{"name": i, "image": i} for i in images],
        "hurt": hurt,
    }
    with open(a["out"], "w") as f:
        json.dump(dump, f, indent=1)
    kept = [m["name"] for m in meshes if m["kept"]]
    print(f"skeleton_from_blend {fighter}: {len(bones)} bones, {len(kept)}/{len(meshes)} meshes kept, {len(hurt)} hurt capsules")
    print("  kept: " + ", ".join(sorted(kept)))
    print("  dropped: " + ", ".join(sorted(m["name"] for m in meshes if not m["kept"])))


main()
```

`scripts/models/skeletons.mjs`:

```js
/**
 * `pnpm models:skeletons`: read every fighter's bones, meshes and vertex
 * weights out of its cached .blend with the stdlib SDNA reader — no Blender —
 * into `.model-cache/dumps/<id>.sdna.json` (Plan 4 Task 6). The committed
 * skeletons are trimmed from these by
 *
 *   UPDATE_SKELETONS=1 pnpm vitest run src/render3d/skeletons/skeletons.test.ts
 *
 * Needs only `pnpm models:fetch` first. The .blend is untrusted downloaded
 * data: the reader runs isolated (`python3 -I -B`) and only parses bytes.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const CACHE = join(ROOT, ".model-cache");
const CODES = { mario: "mario", donkeyKong: "donkey", link: "link", samus: "samus", kirby: "kirby", fox: "fox", pikachu: "pikachu", marth: "marth" };

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1] : null;
const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8"));
mkdirSync(join(CACHE, "dumps"), { recursive: true });

let failed = 0;
for (const id of Object.keys(CODES).filter((f) => only === null || f === only)) {
  const entry = manifest.files.find((f) => f.fighter === id && f.path.endsWith(".blend"));
  if (!entry) {
    console.error(`models:skeletons: manifest has no .blend for ${id}`);
    failed++;
    continue;
  }
  const blend = join(CACHE, "src", id, entry.path.slice(entry.path.lastIndexOf("/") + 1));
  const run = spawnSync(
    "python3",
    ["-I", "-B", join(ROOT, "scripts", "models", "skeleton_from_blend.py"), blend, "--fighter", id, "--code", CODES[id],
      "--meshes", join(ROOT, "scripts", "models", "meshes.json"), "--hurt", join(ROOT, "src", "render3d", "skeletons", "hurtBones.json"),
      "--out", join(CACHE, "dumps", `${id}.sdna.json`)],
    { stdio: "inherit" },
  );
  if (run.status !== 0) failed++;
}
if (failed > 0) {
  console.error(`models:skeletons: ${failed} fighter(s) failed`);
  process.exit(1);
}
```

`package.json` — add to `scripts`: `"models:skeletons": "node scripts/models/skeletons.mjs",`.

- [ ] **Step 4: Run the dump test**

Run: `pnpm vitest run src/render3d/pipeline/dump.test.ts`
Expected: PASS (5 tests; "the local dumps … all parse" and "Blender's dump and the SDNA reader's agree" skipped — no dumps yet). `skeletons.test.ts` still fails (`ENOENT … src/render3d/skeletons/mario.json`) until Step 6.

- [ ] **Step 5: Read the eight skeletons**

Run: `pnpm models:skeletons`
Expected (verified on the real files, Python 3.15): one line per fighter, then its kept and dropped meshes —

```
skeleton_from_blend mario: 98 bones, 8/62 meshes kept, 11 hurt capsules
skeleton_from_blend donkeyKong: 117 bones, 15/58 meshes kept, 11 hurt capsules
skeleton_from_blend link: 145 bones, 13/55 meshes kept, 11 hurt capsules
skeleton_from_blend samus: 53 bones, 24/25 meshes kept, 11 hurt capsules
skeleton_from_blend kirby: 51 bones, 4/26 meshes kept, 7 hurt capsules
skeleton_from_blend fox: 79 bones, 13/37 meshes kept, 11 hurt capsules
skeleton_from_blend pikachu: 77 bones, 4/40 meshes kept, 11 hurt capsules
skeleton_from_blend marth: 145 bones, 16/47 meshes kept, 11 hurt capsules
```

(Mario's `kept:` line: `Mario_Eye_VIS_O_OBJShape(.001)`, `Mario_FaceNMClose_VIS_O_OBJShape`, `Mario_FaceN_VIS_O_OBJShape(.001)`, `Mario_Hathead_VIS_O_OBJShape`, `c00bodyShape(.001)`.) A `mesh … is in neither keep nor drop` failure means the file is not the pinned one — `pnpm models:fetch` first. Then `pnpm vitest run src/render3d/pipeline/dump.test.ts` — Expected: PASS, 6 tests: the eight `.sdna.json` dumps parse.

- [ ] **Step 6: Commit-ready skeletons from the dumps**

`src/render3d/skeletons/index.ts`:

```ts
/**
 * The committed fighter skeletons (Plan 4 Task 6): bone names and bind
 * transforms trimmed to what the sim and the retargeter use, plus the derived
 * hurt capsules. Derived numbers only — no mesh, no texture (spec §3.1).
 */

import { parseSkeletonFile, type SkeletonFile } from "../skeleton/skeleton";
import donkeyKong from "./donkeyKong.json";
import fox from "./fox.json";
import kirby from "./kirby.json";
import link from "./link.json";
import mario from "./mario.json";
import marth from "./marth.json";
import pikachu from "./pikachu.json";
import samus from "./samus.json";

export const SKELETONS: Readonly<Record<string, SkeletonFile>> = Object.fromEntries(
  [mario, donkeyKong, link, samus, kirby, fox, pikachu, marth].map((j) => {
    const s = parseSkeletonFile(j);
    return [s.fighter, s];
  }),
);
```

Run: `UPDATE_SKELETONS=1 pnpm vitest run src/render3d/skeletons/skeletons.test.ts` then `shasum -a 256 src/render3d/skeletons/{mario,donkeyKong,link,samus,kirby,fox,pikachu,marth}.json`
Expected: eight files of 6.3–8.2 KB (25–31 bones each: the bones the retargeter, the hurt capsules and the published scripts use, with their ancestors), byte-identical to the ones verified in scratch:

```
bce25b5f8c91da0b2d4797d6d3505a4d01b128e3b152e019e794008bb58e1437  src/render3d/skeletons/mario.json
6abbf23b65b4cd0567e58f5df468995ae1f04b400b794819efe68ca7b082d231  src/render3d/skeletons/donkeyKong.json
af59feb06d05b2385237cd932a9dbdc3be3f40b1c50134e6fbc85219cbcf1df0  src/render3d/skeletons/link.json
7bbd7692dab8c7b19b5b8413991c4f6455231e257661120eef52a6329b6914bc  src/render3d/skeletons/samus.json
5071914b55e84bdd9bd29fdcad595875772304dcfb24c75d66df00113126089c  src/render3d/skeletons/kirby.json
31ccc011338a1ab5e21778441b3bc0c37a274020f3bd3cd61d9e46f8a7a4a9ae  src/render3d/skeletons/fox.json
228b9d901863d3df75733ea3dfdd362b39782215509b258fb55e0f9f16c1c1a1  src/render3d/skeletons/pikachu.json
90c99d5187e581be0d9dd98866eeb6ad21dc74d8fa10ff8fc3a9d5b08ad52d4b  src/render3d/skeletons/marth.json
```

A different hash means a different input or a different reader: stop and compare the dump with `git diff --no-index` against a known-good copy rather than committing it.

Run: `pnpm vitest run src/render3d/skeletons/skeletons.test.ts`
Expected: PASS (24 tests: per fighter, it calibrates against the retarget map, has every bone its published scripts name — Link's and Marth's `sword1`/`sword2`, Fox's and Pikachu's `tail*` included, so `missing.json` stays `{}` — and has a capsule on exactly the bones `hurtBones.json` lists).

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && python3 -I -B -c "import sys; [compile(open(f).read(), f, 'exec') for f in sys.argv[1:]]" scripts/models/skeleton_from_blend.py`
Expected: exit 0. (The Python check compiles in memory: `python3 -m py_compile` would write `scripts/models/__pycache__/` even under `-B` — ignored since Task 1, but not made at all this way.)

- [ ] **Step 8: Commit** (bone names, bind matrices and capsule sizes — derived numbers; no mesh, no texture, no dump)

```bash
git add super-smash/scripts/models/skeleton_from_blend.py super-smash/scripts/models/skeletons.mjs super-smash/scripts/models/meshes.json super-smash/src/render3d/pipeline/dump.ts super-smash/src/render3d/pipeline/dump.test.ts super-smash/src/engine/acmd/scriptBones.ts super-smash/src/render3d/bake/roster.ts super-smash/src/render3d/skeletons/hurtBones.json super-smash/src/render3d/skeletons/hurtBones.ts super-smash/src/render3d/skeletons/skeletons.test.ts super-smash/src/render3d/skeletons/missing.json super-smash/src/render3d/skeletons/index.ts super-smash/src/render3d/skeletons/mario.json super-smash/src/render3d/skeletons/donkeyKong.json super-smash/src/render3d/skeletons/link.json super-smash/src/render3d/skeletons/samus.json super-smash/src/render3d/skeletons/kirby.json super-smash/src/render3d/skeletons/fox.json super-smash/src/render3d/skeletons/pikachu.json super-smash/src/render3d/skeletons/marth.json super-smash/package.json
git commit -m "super-smash: read the fighters' skeletons from their .blend files without Blender" -m "A stdlib-only SDNA reader (struct, never bpy, run isolated) takes bone names, bind matrices and vertex weights from each pinned .blend; meshes.json names every mesh kept or dropped per fighter; hurt capsules come from the kept meshes' weights (UNVERIFIED), on the bones hurtBones.json lists (Kirby's own set). The eight trimmed skeletons are committed, so the bake, the sim and every test run without Blender or the model cache." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Install Blender 5.2.2, portable, inside the model cache (STOP: ask David)

Blender is needed only to export the glbs (Task 8); it is not a dependency of the game, the tests, the bake or CI — Task 6 already committed everything the sim reads. If David says no, skip Tasks 7–8: every later task and its gate is green without them, and the game draws each fighter as a stand-in built from its hurt capsules (Task 16) until the glbs exist. It goes into the git-ignored `.model-cache/tools/` (about 1 GB unpacked), not `/Applications`, so it is removed with the cache (decided: portable — "Decisions taken" 3).

**Files:** none (local install only).

**Interfaces:** Produces `.model-cache/tools/Blender.app/Contents/MacOS/Blender` (what `scripts/models/build.mjs` runs; `$BLENDER` overrides).

- [ ] **Step 1: STOP: ask David for go.** Say: "Task 7 downloads Blender 5.2.2 for macOS arm64 (346 MB DMG, SHA-256 dc412539…f210) from download.blender.org and unpacks it to `super-smash/.model-cache/tools/Blender.app` (~1 GB, git-ignored, nothing installed system-wide). It only exports the fighter glbs; without it the game runs with stand-ins. Go?" Wait for go.

- [ ] **Step 2: Download and verify**

```bash
mkdir -p .model-cache/tools
curl -fL -o .model-cache/tools/blender-5.2.2-macos-arm64.dmg https://download.blender.org/release/Blender5.2/blender-5.2.2-macos-arm64.dmg
echo "dc4125399b8bfefe283cc1624d6cfc7809d1cac20ace51072127eb371f31f210  .model-cache/tools/blender-5.2.2-macos-arm64.dmg" | shasum -a 256 -c
```
Expected: `.model-cache/tools/blender-5.2.2-macos-arm64.dmg: OK`. Anything else: delete the file and stop — do not install an unverified binary.

- [ ] **Step 3: Unpack and remove the DMG**

```bash
hdiutil attach -nobrowse -readonly -mountpoint .model-cache/tools/mnt .model-cache/tools/blender-5.2.2-macos-arm64.dmg
cp -R .model-cache/tools/mnt/Blender.app .model-cache/tools/Blender.app
hdiutil detach .model-cache/tools/mnt
rm .model-cache/tools/blender-5.2.2-macos-arm64.dmg
.model-cache/tools/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-expr "import bpy; print('BLENDER', bpy.app.version_string)"
```
Expected: the last line prints `BLENDER 5.2.2`. If macOS refuses to run it ("cannot be opened because the developer cannot be verified"), **STOP: ask David** to allow it in System Settings → Privacy & Security; do not clear quarantine attributes yourself.

- [ ] **Step 4: Confirm nothing is staged**

Run: `git -C "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates" status --short super-smash`
Expected: no `.model-cache` entry (ignored since Task 1). No commit in this task.

---


### Task 8: Export the glbs with Blender, joined per texture; verify, publish and guard the deploy

The export script, in order: keep exactly the meshes `meshes.json` lists under `keep` (the reader's rule, so the two agree) and print the kept and dropped ones; rebuild each kept material as Principled BSDF fed by its largest colour texture (colour and alpha, keeping its UV map), merging materials painted from the same texture; dump every bone's bind matrix in SSBU model space and the hurt capsules exactly as the reader computes them; **join the kept meshes into one object**, so the glb has one primitive — one draw call — per texture instead of one per part; export armature + joined mesh as GLB with skins on and animations and morphs off. Without the join the real files are 8 (Mario), 18 (Donkey Kong), 44 (Link), 24 (Samus), 4 (Kirby), 36 (Fox), 40 (Pikachu) and 25 (Marth) meshes — four of the larger ones alone pass the 100-call frame. Distinct materials on the kept parts, read from the files: Mario 5, Donkey Kong 5, Link 8, Samus 4, Kirby 2, Fox 10, Pikachu 3, Marth 10; `glb.mjs` refuses a glb with more than `MAX_PRIMITIVES` = 12. `build.mjs` runs Blender with `--disable-autoexec`: a downloaded `.blend` never runs embedded Python.

**Files:**
- Create: `super-smash/scripts/models/export_gltf.py`, `super-smash/scripts/models/glb.mjs`, `super-smash/scripts/models/build.mjs`, `super-smash/scripts/models/check.mjs`, `super-smash/src/render3d/budget.ts`, `super-smash/src/render3d/pipeline/glb.test.ts`
- Modify: `super-smash/package.json` (scripts and devDependencies), `super-smash/pnpm-lock.yaml`

**Interfaces:**
- Produces (`src/render3d/budget.ts`): `MAX_DRAW_CALLS = 100`, `MAX_TRIANGLES_PER_FRAME = 500_000`, `MAX_FIGHTER_PRIMITIVES = 12`.
- Produces (`scripts/models/glb.mjs`): `MAX_GLB_BYTES = 25 MiB`, `MAX_TRIANGLES = 120000` (a quarter of the 500k scene budget per fighter), `MAX_TEXTURE = 1024`, `MAX_PRIMITIVES = 12` (pinned equal to `MAX_FIGHTER_PRIMITIVES`), `optimizeGlb(in, out)`, `verifyGlb(file, dump): Promise<{ problems; bytes; triangles; primitives; joints }>`.
- Produces (git-ignored): `.model-cache/dumps/<fighterId>.json` (Blender's dump, same schema), `.model-cache/glb/<fighterId>.{raw,opt}.glb`, `public/models/<id>.<sha8>.glb`, `public/models/index.json` `{ schema: 1, models: { <fighterId>: { file, bytes, sha256, skeleton: <sha256 of src/render3d/skeletons/<id>.json> } } }`.
- Scripts: `pnpm models` (fetch → Blender → optimise → verify → publish; `--only`, `--allow-skeleton-drift`), `pnpm models:check` (deploy guard); Plan 1's `deploy` script runs `models:check` first.

- [ ] **Step 1: Install the glTF tooling** (versions pinned, each published more than two weeks ago; `sharp` matches the copy Next 16.3 already installs)

Run: `pnpm add -D @gltf-transform/core@4.5.1 @gltf-transform/functions@4.5.1 @gltf-transform/extensions@4.5.1 meshoptimizer@1.3.0 sharp@0.35.3`
Expected: added; no "Ignored build scripts" line that names one of these (sharp 0.35 ships prebuilt `@img/*` binaries; Plan 1's `allowBuilds: { sharp: false }` stays).

- [ ] **Step 2: Write the failing test** — `src/render3d/pipeline/glb.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Document, NodeIO } from "@gltf-transform/core";
import { afterAll, describe, expect, it } from "vitest";

import { MAX_PRIMITIVES, verifyGlb } from "../../../scripts/models/glb.mjs";
import { MAX_FIGHTER_PRIMITIVES } from "../budget";

const dir = mkdtempSync(join(tmpdir(), "glb-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A one-triangle-per-primitive glb with `n` primitives on one mesh. */
async function glbWith(n: number): Promise<string> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh("body");
  for (let i = 0; i < n; i++) {
    const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", pos).setMaterial(doc.createMaterial(`m${i}`)));
  }
  doc.createScene().addChild(doc.createNode("body").setMesh(mesh));
  const file = join(dir, `p${n}.glb`);
  await new NodeIO().write(file, doc);
  return file;
}

describe("verifyGlb's draw-call cap", () => {
  it("passes a fighter drawn in MAX_PRIMITIVES (12) primitives", async () => {
    expect(MAX_PRIMITIVES).toBe(MAX_FIGHTER_PRIMITIVES); // the renderer's budget test assumes this cap
    const r = await verifyGlb(await glbWith(MAX_PRIMITIVES), { bones: [] });
    expect(r.primitives).toBe(MAX_PRIMITIVES);
    expect(r.problems.filter((p: string) => p.includes("primitives"))).toEqual([]);
  });

  it("fails one drawn in more — four fighters must stay a fraction of the 100-draw-call frame", async () => {
    const r = await verifyGlb(await glbWith(MAX_PRIMITIVES + 1), { bones: [] });
    expect(r.problems).toContainEqual(expect.stringContaining(`${MAX_PRIMITIVES + 1} primitives > ${MAX_PRIMITIVES}`));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/pipeline/glb.test.ts`
Expected: FAIL — `Error: Cannot find module '../../../scripts/models/glb.mjs' imported from …/src/render3d/pipeline/glb.test.ts` (a node-environment test).

- [ ] **Step 4: Implement** — `src/render3d/budget.ts`:

```ts
/**
 * The R§4 frame budget the 3D layer is held to (Plan 4): under 100 draw calls
 * and 500k triangles at 1080p with four fighters. A fighter costs one draw call
 * per glb primitive; `scripts/models/export_gltf.py` joins its parts to one
 * primitive per texture and `scripts/models/glb.mjs` refuses a glb with more
 * than `MAX_FIGHTER_PRIMITIVES` (its `MAX_PRIMITIVES`, pinned equal by
 * `pipeline/glb.test.ts`), so four fighters stay under half the frame.
 */

export const MAX_DRAW_CALLS = 100;
export const MAX_TRIANGLES_PER_FRAME = 500_000;
export const MAX_FIGHTER_PRIMITIVES = 12;
```

`scripts/models/glb.mjs`:

```js
/**
 * Shrink a Blender-exported fighter glb for the web, and prove what came out
 * (Plan 4). Used by `build.mjs`; also a CLI:
 *
 *   node scripts/models/glb.mjs optimize <in.glb> <out.glb>
 *   node scripts/models/glb.mjs verify <out.glb> <dump.json>
 *
 * optimize: dedup → prune → weld → textures to WebP ≤ 1024 px → meshopt
 * (quantised positions/normals/UVs/weights + EXT_meshopt_compression, decoded
 * in the browser by three's bundled MeshoptDecoder — no wasm to host).
 * verify: the R§4 budget per file (≤ 25 MiB, ≤ 120k triangles — a quarter of
 * the 500k scene budget per fighter, leaving the stage room), ≤ 12 primitives
 * (one draw call each: four fighters stay under half of the 100-call frame,
 * `renderer3d.test.ts`), no texture over 1024 px, and every joint where the
 * bone dump says it is.
 */

import { readFileSync, statSync } from "node:fs";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

export const MAX_GLB_BYTES = 25 * 1024 * 1024;
export const MAX_TRIANGLES = 120_000;
export const MAX_TEXTURE = 1024;
/** Draw calls per fighter: export_gltf.py joins the parts, one primitive per texture (Fox and Marth: 10). */
export const MAX_PRIMITIVES = 12;

async function io() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

export async function optimizeGlb(input, output) {
  const nio = await io();
  const doc = await nio.read(input);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [MAX_TEXTURE, MAX_TEXTURE] }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  await nio.write(output, doc);
}

function primitives(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) n += mesh.listPrimitives().length;
  return n;
}

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : (prim.getAttribute("POSITION")?.getCount() ?? 0);
      n += Math.floor(count / 3);
    }
  }
  return n;
}

/** Problems with a built glb, empty when it is fit to ship. */
export async function verifyGlb(file, dump) {
  const problems = [];
  const bytes = statSync(file).size;
  if (bytes > MAX_GLB_BYTES) problems.push(`${file}: ${bytes} bytes > 25 MiB (Workers static assets limit)`);
  const doc = await (await io()).read(file);
  const tris = triangles(doc);
  if (tris > MAX_TRIANGLES) problems.push(`${file}: ${tris} triangles > ${MAX_TRIANGLES}`);
  const prims = primitives(doc);
  if (prims > MAX_PRIMITIVES) problems.push(`${file}: ${prims} primitives > ${MAX_PRIMITIVES} (did export_gltf.py join the meshes?)`);
  for (const tex of doc.getRoot().listTextures()) {
    const size = tex.getSize();
    if (size && Math.max(size[0], size[1]) > MAX_TEXTURE) problems.push(`${file}: texture ${tex.getName()} is ${size[0]}×${size[1]}`);
  }
  if (doc.getRoot().listSkins().length === 0) problems.push(`${file}: no skin`);
  const joints = new Map();
  for (const skin of doc.getRoot().listSkins()) for (const j of skin.listJoints()) joints.set(j.getName(), j);
  for (const bone of dump.bones) {
    const j = joints.get(bone.name);
    if (j === undefined) continue; // unweighted bones may be pruned from the skin; the bake reads the dump
    const m = j.getWorldMatrix();
    const off = Math.max(...m.map((v, i) => Math.abs(v - bone.world[i])));
    if (off > 1e-2) problems.push(`${file}: joint ${bone.name} is ${off.toFixed(4)} from the dump's bind pose`);
  }
  for (const name of ["Hip", "Head"]) if (!joints.has(name)) problems.push(`${file}: no ${name} joint`);
  return { problems, bytes, triangles: tris, primitives: prims, joints: joints.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "optimize") await optimizeGlb(a, b);
  else if (cmd === "verify") {
    const r = await verifyGlb(a, JSON.parse(readFileSync(b, "utf8")));
    console.log(JSON.stringify({ bytes: r.bytes, triangles: r.triangles, primitives: r.primitives, joints: r.joints }));
    for (const p of r.problems) console.error(p);
    process.exit(r.problems.length ? 1 : 0);
  } else {
    console.error("usage: glb.mjs optimize <in> <out> | verify <glb> <dump>");
    process.exit(2);
  }
}
```

Run: `pnpm vitest run src/render3d/pipeline/glb.test.ts`
Expected: PASS (2 tests: twelve one-triangle primitives pass, thirteen fail with `13 primitives > 12 (did export_gltf.py join the meshes?)`).

`scripts/models/export_gltf.py`:

```python
"""
Blender headless: one fighter's c00 .blend -> a skinned .glb and a bone dump.

    .model-cache/tools/Blender.app/Contents/MacOS/Blender -b <blend> \
        --python scripts/models/export_gltf.py -- \
        --fighter mario --glb .model-cache/glb/mario.raw.glb \
        --dump .model-cache/dumps/mario.json --meshes scripts/models/meshes.json \
        --hurt src/render3d/skeletons/hurtBones.json

Run by scripts/models/build.mjs for each fighter (Plan 4 Task 8). What it does:
1. Keeps exactly the meshes `scripts/models/meshes.json` lists under `keep`
   for this fighter (names without Blender's `.NNN` suffix) and deletes those
   under `drop`: the neutral face, eyes and body stay; alternate expressions,
   blinks, low-poly duplicates and sheathed-sword copies go. A mesh in neither
   list fails the export -- the lists are exhaustive, written from the real
   files, so a new upstream mesh is a decision, not a silent guess.
2. Rebuilds every kept material as Principled BSDF <- the material's c00
   colour texture (`*_col.png`, largest if several), colour and alpha, keeping
   the texture's UV map; materials that end up on the same texture become one.
3. Dumps every bone's bind matrix in SSBU model space and per-bone hurt
   capsules derived from the kept meshes' vertex weights (UNVERIFIED sizes) --
   the same numbers `skeleton_from_blend.py` reads without Blender, which
   `dump.test.ts` cross-checks.
4. Joins the kept meshes into one object, so the glb has one primitive per
   texture (at most `MAX_PRIMITIVES` in glb.mjs) instead of one per part:
   Link's 13 kept parts are 8 draw calls, not 44.
5. Exports armature + the joined mesh as GLB (skins on, animations and morphs off).

Prints the kept and dropped meshes. Fails loudly (exit 1, a message naming the
fighter) on: no or several armatures, a mesh missing from meshes.json, a kept
material with no colour texture, an unloadable texture, or an exporter missing
an option. Schema of the dump: src/render3d/pipeline/dump.ts.
"""

import json
import math
import re
import sys

import bpy
import mathutils

DUMP_SCHEMA = 1
SUFFIX = re.compile(r"\.\d+$")
# Blender world (Z up) -> glTF / SSBU model space (Y up): (x, y, z) -> (x, z, -y).
Z_UP_TO_Y_UP = mathutils.Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
# Vertices weighted to these (and below them) are props, not body: no hurtbox.
NOT_BODY = re.compile(r"^(Have|Sword|Tail|Throw)", re.IGNORECASE)


def fail(fighter, why):
    print(f"export_gltf {fighter}: {why}", file=sys.stderr)
    sys.exit(1)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    for i in range(0, len(argv), 2):
        out[argv[i].lstrip("-")] = argv[i + 1]
    for k in ("fighter", "glb", "dump", "meshes", "hurt"):
        if k not in out:
            fail(out.get("fighter", "?"), f"missing --{k}")
    return out


def load_json(path):
    with open(path) as f:
        return json.load(f)


def flat(m):
    """Column-major list of a 4x4 mathutils matrix."""
    return [round(m[r][c], 6) for c in range(4) for r in range(4)]


def colour_image(material):
    if material.node_tree is None:
        return None, None
    best, best_node = None, None
    for node in material.node_tree.nodes:
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        if re.search(r"_(nor|prm|emi)\.png$", node.image.name.lower()):
            continue
        size = node.image.size[0] * node.image.size[1]
        if best is None or size > best.size[0] * best.size[1]:
            best, best_node = node.image, node
    return best, best_node


def rebuild_material(fighter, material):
    image, image_node = colour_image(material)
    if image is None:
        fail(fighter, f"material {material.name} has no colour texture")
    image.reload()
    if image.size[0] == 0:
        fail(fighter, f"texture {image.filepath} for {material.name} did not load (is it in .model-cache/src/{fighter}/?)")
    tree = material.node_tree
    uv_link = next((l for l in tree.links if l.to_node == image_node and l.to_socket.name == "Vector"), None)
    uv_node = uv_link.from_node if uv_link is not None else None
    uv_name = uv_node.uv_map if uv_node is not None and uv_node.type == "UVMAP" else None
    for node in list(tree.nodes):
        if node not in (image_node, uv_node):
            tree.nodes.remove(node)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(image_node.outputs["Color"], bsdf.inputs["Base Color"])
    tree.links.new(image_node.outputs["Alpha"], bsdf.inputs["Alpha"])
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    if uv_name is not None:
        uv = tree.nodes.new("ShaderNodeUVMap")
        uv.uv_map = uv_name
        tree.links.new(uv.outputs["UV"], image_node.inputs["Vector"])
    return image.name


def hurt_capsules(fighter, armature, meshes, bone_model, hurt_bones):
    """Per hurt bone: a capsule along its local +X from the kept meshes' vertices."""
    bones = armature.data.bones
    owner = {}
    for b in bones:
        chain, at = [], b
        while at is not None:
            chain.append(at.name)
            at = at.parent
        if any(NOT_BODY.match(n) for n in chain):
            owner[b.name] = None
        else:
            owner[b.name] = next((n for n in chain if n in hurt_bones), None)
    points = {name: [] for name in hurt_bones}
    inverse = {name: bone_model[name].inverted() for name in hurt_bones if name in bone_model}
    for obj in meshes:
        to_model = Z_UP_TO_Y_UP @ obj.matrix_world
        groups = obj.vertex_groups
        for v in obj.data.vertices:
            if not v.groups:
                continue
            g = max(v.groups, key=lambda e: e.weight)
            target = owner.get(groups[g.group].name)
            if target is None or target not in inverse:
                continue
            points[target].append(inverse[target] @ (to_model @ v.co))
    out = []
    for name in hurt_bones:
        pts = points[name]
        if len(pts) < 8:
            fail(fighter, f"hurt bone {name} owns only {len(pts)} kept vertices")
        xs = sorted(p.x for p in pts)
        rs = sorted(math.hypot(p.y, p.z) for p in pts)
        pick = lambda arr, q: arr[min(len(arr) - 1, int(q * len(arr)))]
        # A capsule whose rounded ends reach the 5th and 95th percentile along
        # the bone and whose radius covers three quarters of the vertices
        # around it; a part shorter than its own width is a sphere at its middle.
        r = pick(rs, 0.75)
        lo, hi = pick(xs, 0.05), pick(xs, 0.95)
        x1, x2 = lo + r, hi - r
        if x1 > x2:
            x1 = x2 = (lo + hi) / 2
        out.append({"bone": name, "x1": round(x1, 5), "x2": round(x2, 5), "r": round(r, 5)})
    return out


def main():
    a = args()
    fighter = a["fighter"]
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        fail(fighter, f"expected one armature, found {len(armatures)}")
    armature = armatures[0]

    rules = load_json(a["meshes"]).get(fighter)
    if rules is None:
        fail(fighter, f"no entry in {a['meshes']}")
    hurt_table = load_json(a["hurt"])
    hurt_bones = hurt_table.get(fighter, hurt_table["default"])["bones"]
    listed = set(rules["keep"]) | set(rules["drop"])
    meshes, mesh_report = [], []
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        base = SUFFIX.sub("", obj.name)
        if base not in listed:
            fail(fighter, f"mesh {obj.name} is in neither keep nor drop of scripts/models/meshes.json")
        kept = obj.parent == armature and base in rules["keep"]
        mesh_report.append({"name": obj.name, "kept": kept, "verts": len(obj.data.vertices), "polys": len(obj.data.polygons)})
        if kept:
            meshes.append(obj)
        else:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not meshes:
        fail(fighter, "kept no mesh")
    print(f"export_gltf {fighter}: kept " + ", ".join(sorted(m["name"] for m in mesh_report if m["kept"])))
    print(f"export_gltf {fighter}: dropped " + ", ".join(sorted(m["name"] for m in mesh_report if not m["kept"])))

    materials = []
    by_image = {}
    for obj in meshes:
        for slot in obj.material_slots:
            if slot.material is None:
                continue
            if slot.material.name not in {m["name"] for m in materials}:
                image = rebuild_material(fighter, slot.material)
                materials.append({"name": slot.material.name, "image": image})
                by_image.setdefault(image, slot.material)
            # One material per texture: two parts painted from one image draw together.
            slot.material = by_image[next(m["image"] for m in materials if m["name"] == slot.material.name)]

    bone_model = {}
    bones = []
    for b in armature.data.bones:
        m = Z_UP_TO_Y_UP @ armature.matrix_world @ b.matrix_local
        bone_model[b.name] = m
        bones.append({"name": b.name, "parent": b.parent.name if b.parent else None, "world": flat(m)})

    dump = {
        "schema": DUMP_SCHEMA,
        "fighter": fighter,
        "code": a.get("code", fighter),
        "blender": bpy.app.version_string,
        "blend": bpy.path.basename(bpy.data.filepath),
        "space": "ssbu-model",
        "bones": bones,
        "meshes": mesh_report,
        "materials": materials,
        "hurt": hurt_capsules(fighter, armature, meshes, bone_model, hurt_bones),
    }
    with open(a["dump"], "w") as f:
        json.dump(dump, f, indent=1)

    # Join after the dump: the capsules read each part's own transform, and
    # joining keeps vertex groups by name, so skinning is unchanged.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = armature
    options = dict(
        filepath=a["glb"],
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
    )
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    missing = [k for k in options if k not in known]
    if missing:
        fail(fighter, f"this Blender's glTF exporter lacks options {missing}")
    bpy.ops.export_scene.gltf(**options)
    print(f"export_gltf {fighter}: {len(meshes)} meshes joined, {len(by_image)} textures, {len(bones)} bones, {len(dump['hurt'])} hurt capsules")


main()
```

`scripts/models/build.mjs`:

```js
/**
 * `pnpm models`: fetch → Blender export → optimise → verify → publish, for
 * every fighter (Plan 4). Output is git-ignored: `public/models/<id>.<hash8>.glb`
 * and `public/models/index.json`; scratch work goes in `.model-cache/`.
 *
 *   pnpm models                       # all eight
 *   pnpm models -- --only mario       # one
 *   pnpm models -- --allow-skeleton-drift   # the spike, before skeletons are committed
 *
 * Blender: `$BLENDER`, else the portable copy Task 7 installs in
 * `.model-cache/tools/Blender.app`. Each glb records the SHA-256 of the
 * committed skeleton it matches, so `check.mjs` can refuse to deploy models
 * built against different bones than the committed bake.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { optimizeGlb, verifyGlb } from "./glb.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const CACHE = join(ROOT, ".model-cache");
const OUT = join(ROOT, "public", "models");
const BLENDER = process.env.BLENDER ?? join(CACHE, "tools", "Blender.app", "Contents", "MacOS", "Blender");
const CODES = { mario: "mario", donkeyKong: "donkey", link: "link", samus: "samus", kirby: "kirby", fox: "fox", pikachu: "pikachu", marth: "marth" };

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1] : null;
const allowDrift = argv.includes("--allow-skeleton-drift");
const fighters = Object.keys(CODES).filter((id) => only === null || id === only);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const die = (msg) => {
  console.error(`pnpm models: ${msg}`);
  process.exit(1);
};

if (!existsSync(BLENDER)) die(`no Blender at ${BLENDER} — Plan 4 Task 7 installs it (or set BLENDER=…)`);

const fetch = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "models", "fetch.mjs"), ...(only ? ["--only", only] : [])], { stdio: "inherit" });
if (fetch.status !== 0) die("fetch failed");

const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8"));
for (const dir of ["glb", "dumps"]) mkdirSync(join(CACHE, dir), { recursive: true });
mkdirSync(OUT, { recursive: true });
const indexFile = join(OUT, "index.json");
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { schema: 1, models: {} };

for (const id of fighters) {
  const blendEntry = manifest.files.find((f) => f.fighter === id && f.path.endsWith(".blend"));
  if (!blendEntry) die(`manifest has no .blend for ${id}`);
  const blend = join(CACHE, "src", id, blendEntry.path.slice(blendEntry.path.lastIndexOf("/") + 1));
  const raw = join(CACHE, "glb", `${id}.raw.glb`);
  const opt = join(CACHE, "glb", `${id}.opt.glb`);
  const dumpFile = join(CACHE, "dumps", `${id}.json`);

  const blender = spawnSync(
    BLENDER,
    // The .blend is downloaded data: never let it run embedded Python.
    ["--background", "--disable-autoexec", blend, "--python-exit-code", "1", "--python", join(ROOT, "scripts", "models", "export_gltf.py"), "--",
      "--fighter", id, "--code", CODES[id], "--glb", raw, "--dump", dumpFile,
      "--meshes", join(ROOT, "scripts", "models", "meshes.json"), "--hurt", join(ROOT, "src", "render3d", "skeletons", "hurtBones.json")],
    { stdio: "inherit" },
  );
  if (blender.status !== 0) die(`Blender export failed for ${id}`);

  await optimizeGlb(raw, opt);
  const dump = JSON.parse(readFileSync(dumpFile, "utf8"));
  const report = await verifyGlb(opt, dump);
  if (report.problems.length > 0) die(report.problems.join("\n"));

  const skeletonFile = join(ROOT, "src", "render3d", "skeletons", `${id}.json`);
  let skeletonSha = null;
  if (existsSync(skeletonFile)) {
    const committed = JSON.parse(readFileSync(skeletonFile, "utf8"));
    const byName = new Map(dump.bones.map((b) => [b.name, b]));
    const drift = committed.bones.filter((b) => {
      const d = byName.get(b.name);
      return !d || d.world.some((v, i) => Math.abs(v - b.world[i]) > 1e-4);
    });
    if (drift.length > 0 && !allowDrift) {
      die(`${id}: ${drift.length} bones differ from src/render3d/skeletons/${id}.json (${drift.slice(0, 4).map((b) => b.name).join(", ")}…). Re-run UPDATE_SKELETONS=1 then UPDATE_BAKE=1 (Plan 4 Tasks 6 and 10).`);
    }
    skeletonSha = sha256(readFileSync(skeletonFile));
  } else if (!allowDrift) {
    die(`no committed skeleton for ${id} — during the spike pass --allow-skeleton-drift`);
  }

  const bytes = readFileSync(opt);
  const hash = sha256(bytes);
  const file = `${id}.${hash.slice(0, 8)}.glb`;
  for (const old of readdirSync(OUT)) if (old.startsWith(`${id}.`) && old.endsWith(".glb") && old !== file) rmSync(join(OUT, old));
  copyFileSync(opt, join(OUT, file));
  index.models[id] = { file, bytes: bytes.length, sha256: hash, skeleton: skeletonSha };
  console.log(`${id}: ${file}  ${(bytes.length / 1048576).toFixed(2)} MiB  ${report.triangles} tris  ${report.primitives} primitives  ${report.joints} joints`);
}

writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
console.log(`pnpm models: wrote ${Object.keys(index.models).length} model(s) to public/models/`);
```

`scripts/models/check.mjs`:

```js
/**
 * Deploy guard (Plan 4): refuse to build a deploy whose models are missing,
 * changed since they were built, over Cloudflare's 25 MiB per-file limit, or
 * built against a different skeleton than the committed bake.
 *
 *   node scripts/models/check.mjs     # run by `pnpm run deploy` before `next build`
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const FIGHTERS = ["mario", "donkeyKong", "link", "samus", "kirby", "fox", "pikachu", "marth"];
const MAX = 25 * 1024 * 1024;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const problems = [];

const indexFile = join(ROOT, "public", "models", "index.json");
if (!existsSync(indexFile)) {
  problems.push("public/models/index.json is missing — run `pnpm models`");
} else {
  const index = JSON.parse(readFileSync(indexFile, "utf8"));
  for (const id of FIGHTERS) {
    const e = index.models?.[id];
    if (!e) {
      problems.push(`${id}: not built — run \`pnpm models\``);
      continue;
    }
    const file = join(ROOT, "public", "models", e.file);
    if (!existsSync(file)) {
      problems.push(`${id}: ${e.file} is missing — run \`pnpm models\``);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length > MAX) problems.push(`${id}: ${e.file} is ${bytes.length} bytes, over 25 MiB`);
    if (sha256(bytes) !== e.sha256) problems.push(`${id}: ${e.file} changed since it was built`);
    const skeleton = readFileSync(join(ROOT, "src", "render3d", "skeletons", `${id}.json`));
    if (e.skeleton !== sha256(skeleton)) problems.push(`${id}: built against another skeleton than the committed one — run \`pnpm models\``);
  }
}

if (problems.length > 0) {
  console.error(`models:check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("models:check: all eight fighters built against the committed skeletons");
```

`package.json` scripts — add `"models": "node scripts/models/build.mjs",` and `"models:check": "node scripts/models/check.mjs",`, and change Plan 1's `"deploy": "next build && wrangler deploy"` to `"deploy": "node scripts/models/check.mjs && next build && wrangler deploy"` (Plan 1 Task 24's deploy then refuses to ship a build without the eight current glbs; `next build` copies `public/models/` into `out/models/`, which Workers Static Assets serves from local disk).

- [ ] **Step 5: Spike on Mario** (needs Task 7's Blender)

```bash
mkdir -p .model-cache/glb .model-cache/dumps
.model-cache/tools/Blender.app/Contents/MacOS/Blender --background --disable-autoexec .model-cache/src/mario/mario-c00.blend --python-exit-code 1 --python scripts/models/export_gltf.py -- --fighter mario --code mario --glb .model-cache/glb/mario.raw.glb --dump .model-cache/dumps/mario.json --meshes scripts/models/meshes.json --hurt src/render3d/skeletons/hurtBones.json
```
Expected: exit 0; `export_gltf mario: kept …` with the same eight meshes Task 6 printed, `export_gltf mario: dropped …` with the other 54, and `export_gltf mario: 8 meshes joined, <t> textures, 98 bones, 11 hurt capsules` with t ≤ 5. Then `pnpm vitest run src/render3d/pipeline/dump.test.ts` — Expected: PASS, 7 tests: "Blender's dump and the SDNA reader's agree on every bone, kept mesh and hurt capsule" now runs for Mario.
If Blender reports a missing glTF option (`this Blender's glTF exporter lacks options [...]`), print the exporter's options with `.model-cache/tools/Blender.app/Contents/MacOS/Blender -b --python-expr "import bpy; print(sorted(bpy.ops.export_scene.gltf.get_rna_type().properties.keys()))"`, rename the one option in `export_gltf.py`'s `options` to its 5.2 spelling, and rerun. If the cross-check fails on bones, Blender's `matrix_local` differs from the reader's `arm_mat`: the reader's numbers are the committed ones, so fix `export_gltf.py` (not the skeletons). If `bpy.ops.object.join()` fails for want of a context, run it inside `with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes):` and rerun.

- [ ] **Step 6: Build all eight**

Run: `pnpm models`
Expected: per fighter `<id>: <id>.<sha8>.glb  <x.xx> MiB  <t> tris  <p> primitives  <j> joints`, every file under 25 MiB, t under 120000 (Mario's body mesh alone is 4,124 polygons) and p at most 12 (from the material counts above: Fox and Marth 10, the rest fewer), ending `pnpm models: wrote 8 model(s) to public/models/`. `build.mjs` compares each Blender dump's bones with the committed skeleton and stops on drift; a verify failure prints the problem and exits 1 (a joint "… from the dump's bind pose" means the glTF exporter changed bone axes — compare one joint's matrix in the glb, `node scripts/models/glb.mjs verify .model-cache/glb/<id>.opt.glb .model-cache/dumps/<id>.json`, with the dump and fix the export). Then `pnpm vitest run src/render3d/pipeline/dump.test.ts` — Expected: PASS, the cross-check covering all eight.

- [ ] **Step 7: Check the deploy guard**

Run: `pnpm models:check`
Expected: `models:check: all eight fighters built against the committed skeletons`. Then `mv public/models/index.json .model-cache/index.json.bak && pnpm models:check; mv .model-cache/index.json.bak public/models/index.json` — Expected: exit 1 with `public/models/index.json is missing — run \`pnpm models\``.

- [ ] **Step 8: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && python3 -I -B -c "import sys; [compile(open(f).read(), f, 'exec') for f in sys.argv[1:]]" scripts/models/export_gltf.py scripts/models/skeleton_from_blend.py`
Expected: exit 0.

- [ ] **Step 9: Commit** (scripts only; no glb, no dump, no texture — `git status --short` must show nothing under `public/models/` or `.model-cache/`, and Task 5's guard test enforces it)

```bash
git add super-smash/scripts/models/export_gltf.py super-smash/scripts/models/glb.mjs super-smash/scripts/models/build.mjs super-smash/scripts/models/check.mjs super-smash/src/render3d/budget.ts super-smash/src/render3d/pipeline/glb.test.ts super-smash/package.json super-smash/pnpm-lock.yaml
git commit -m "super-smash: pnpm models exports, joins and optimises the fighter glbs" -m "Blender keeps the meshes meshes.json lists, rebuilds each material from its colour map and joins the parts into one primitive per texture (at most 12 per fighter, so four fighters stay under half the 100-draw-call frame); gltf-transform converts textures to WebP at most 1024 px and meshopt-compresses; each glb is verified under 25 MiB, 120k triangles and 12 primitives with every joint on the bind pose. Blender's dump is cross-checked against the committed skeletons; models:check refuses a deploy built against other bones." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The pose clock — which baked frame a fighter's bones are on, in integers

A `BoneTable` is indexed by (motion, frame). This module turns a `FighterState` into that index for the sim and the 3D renderer alike. A move plays its `game_` script's motion at the interpreter's `motionFrame` (so `FT_MOTION_RATE` indexes the bake exactly as it indexes hitboxes); every other state plays `status_<action>` (`_aerial` for a second jump, `_fast` for a fast fall) on a clock the bake declares: once through a fixed-length state (`statusDuration`, the state machine's own constants), scaled across a variable-length one (60 samples: exact for any length dividing 60), looping, looping on the match frame offset per port (idle), or paced by ground covered (walk, run — `STRIDE_UNITS` = 36, the renderer's `STRIDE`). A jump's rise is timed by the engine's own rise (`jumpRiseSpeeds`, Plan 2) — the number `jumpTimingFor` gives the 2D path, so all three agree.

**Files:**
- Create: `super-smash/src/engine/acmd/poseClock.ts`, `super-smash/src/engine/acmd/poseClock.test.ts`
- Modify: `super-smash/src/render/poses/timing.ts` (export `SLOT_POSE` and `PACED_BY_SPEED`; `STRIDE` reads `STRIDE_UNITS`)

**Interfaces:**
- Consumes: `moveScriptFrame` (Plan 2 `acmd/run.ts`), `fighterParams`/`FighterParams` (`params.ts`), `jumpRiseSpeeds`/`JumpKind` (`kinetic.ts`), the state constants in `constants.ts`/`states.ts`. Plan 3's statuses (`tech`, `techRoll`, `techWall`, `techCeiling`, `ledgeTrumped`) are open-ended here exactly as in `actionDurationFor`, and their clips are Plan 3's `poseNameFor` choices.
- Produces: `ClockedFighter`, `ClockKind = "script" | "once" | "scaled" | "loop" | "idle" | "paced"`, `MotionClock { kind; frames }`, `SCALED_FRAMES = 60`, `STRIDE_UNITS = 36`, `IDLE_PORT_OFFSET = 27`, `OPEN_ENDED_FRAMES = 30`, `playsMoveScript(action)`, `statusMotion(f)`, `VARIABLE_LENGTH_ACTIONS`, `jumpRiseFrames(params, f)`, `statusDuration(f, def?)`, `ClockLookup = (fighterId, motion) => MotionClock | undefined`, `PoseIndex { motion; frame }`, `poseIndexOf(def, f, globalFrame, clockOf): PoseIndex | null`, `clipTimeOfFrame(clock, frame)`.

- [ ] **Step 1: Write the failing test** — `src/engine/acmd/poseClock.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fx } from "../fixed";
import { jumpRiseSpeeds } from "../kinetic";
import type { FighterParams } from "../params";
import type { ActionState, FighterDef, FighterState } from "../types";
import { STATUS_KIND_OF_ACTION } from "../status/kind";
import { LANDING_ANIMATION_FRAMES } from "../states";
import { SCALED_FRAMES, STRIDE_UNITS, poseIndexOf, statusDuration, statusMotion, type MotionClock } from "./poseClock";

const PARAMS = { jump_initial_y: 0, jump_y: fx(20), mini_jump_y: fx(9.8), jump_aerial_y: fx(16.2), air_accel_y: fx(0.1) } as unknown as FighterParams;
const DEF = { id: "test", params: PARAMS, moves: {} } as unknown as FighterDef;

const fighter = (over: Partial<FighterState>): FighterState =>
  ({ defId: "test", action: "stand", actionFrame: 0, move: null, port: 0, charge: 0, hitstun: 0, jumpsUsed: 1, fastFalling: false, vx: 0, shortHop: false, ...over }) as FighterState;

const clocks = (table: Record<string, MotionClock>) => (_id: string, motion: string) => table[motion];

describe("the pose clock (which baked frame a fighter's bones are on)", () => {
  it("names a status motion per action, with the second jump and the fast fall apart", () => {
    expect(statusMotion({ action: "stand", jumpsUsed: 1, fastFalling: false })).toBe("status_stand");
    expect(statusMotion({ action: "jump", jumpsUsed: 2, fastFalling: false })).toBe("status_jump_aerial");
    expect(statusMotion({ action: "fall", jumpsUsed: 1, fastFalling: true })).toBe("status_fall_fast");
    const all = (Object.keys(STATUS_KIND_OF_ACTION) as ActionState[]).map((action) => statusMotion({ action, jumpsUsed: 1, fastFalling: false }));
    expect(new Set(all).size).toBe(all.length);
  });

  it("runs a fixed-length state once, frame for frame, and holds its last frame", () => {
    const c = clocks({ status_crouchStart: { kind: "once", frames: 5 } });
    expect(poseIndexOf(DEF, fighter({ action: "crouchStart", actionFrame: 0 }), 0, c)).toEqual({ motion: "status_crouchStart", frame: 1 });
    expect(poseIndexOf(DEF, fighter({ action: "crouchStart", actionFrame: 4 }), 0, c)?.frame).toBe(5);
    expect(poseIndexOf(DEF, fighter({ action: "crouchStart", actionFrame: 40 }), 0, c)?.frame).toBe(5);
  });

  it("stretches a variable-length state across its baked samples by its own length", () => {
    const c = clocks({ status_landingLag: { kind: "scaled", frames: SCALED_FRAMES } });
    // A 15-frame landing lag: frame 5 is a third of the way through.
    expect(poseIndexOf(DEF, fighter({ action: "landingLag", charge: 15, actionFrame: 5 }), 0, c)?.frame).toBe(SCALED_FRAMES / 3 + 1);
    expect(poseIndexOf(DEF, fighter({ action: "landingLag", charge: 0, actionFrame: 2 }), 0, c)?.frame).toBe((2 * SCALED_FRAMES) / LANDING_ANIMATION_FRAMES + 1);
  });

  it("loops idle on the match clock, offset per port, so four fighters do not breathe in step", () => {
    const c = clocks({ status_stand: { kind: "idle", frames: 30 } });
    expect(poseIndexOf(DEF, fighter({ port: 0 }), 31, c)?.frame).toBe(2);
    expect(poseIndexOf(DEF, fighter({ port: 1 }), 31, c)?.frame).toBe(((31 + 27) % 30) + 1);
  });

  it("paces walking by ground covered, in integers", () => {
    const c = clocks({ status_walk: { kind: "paced", frames: 32 } });
    // 1 unit/frame for 18 frames is half a 36-unit stride: half the cycle.
    expect(poseIndexOf(DEF, fighter({ action: "walk", actionFrame: 18, vx: fx(1) }), 0, c)?.frame).toBe(17);
    expect(poseIndexOf(DEF, fighter({ action: "walk", actionFrame: 18, vx: fx(-1) }), 0, c)?.frame).toBe(17);
    expect(STRIDE_UNITS).toBe(36);
  });

  it("knows nothing without a clock, so callers keep Plan 2's single capsule", () => {
    expect(poseIndexOf(DEF, fighter({}), 0, () => undefined)).toBeNull();
  });

  it("times a jump by the engine's own rise, as the 2D renderer's jumpTimingFor does", () => {
    const full = statusDuration(fighter({ action: "jump", jumpsUsed: 1 }), DEF)!;
    const short = statusDuration(fighter({ action: "jump", jumpsUsed: 1, shortHop: true }), DEF)!;
    const air = statusDuration(fighter({ action: "jump", jumpsUsed: 2 }), DEF)!;
    expect(full).toBe(jumpRiseSpeeds(PARAMS, "full").length);
    expect(short).toBe(jumpRiseSpeeds(PARAMS, "short").length);
    expect(air).toBe(jumpRiseSpeeds(PARAMS, "air", 0).length);
    expect(short).toBeLessThan(air);
    expect(air).toBeLessThan(full);
    expect(statusDuration(fighter({ action: "hitstun", actionFrame: 7, hitstun: 13 }))).toBe(20);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/acmd/poseClock.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./poseClock" from "src/engine/acmd/poseClock.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/engine/acmd/poseClock.ts`:

```ts
/**
 * Which motion a fighter is playing, and which frame of it — in integers.
 *
 * Plan 4 bakes every bone of every motion into `BoneTable`s (`bones.ts`). A
 * table is indexed by (motion, frame); this module is the one place that turns
 * a `FighterState` into that index, for the sim (hurtboxes, the ECB) and for the
 * renderer alike, so the two cannot disagree about where a limb is.
 *
 * - A move (`attack`, `special`, `throw`, `grab`, `pummel` with a slot) plays
 *   its `game_` script's motion at the interpreter's `motionFrame`, so
 *   `FT_MOTION_RATE` indexes the bake exactly as it indexes hitboxes.
 * - Every other status plays `status_<action>` (with `_aerial` for a second
 *   jump and `_fast` for a fast fall), on a clock the bake declares per motion
 *   (`MotionClock`): once through a fixed-length state, scaled across a
 *   variable-length one, looping, looping on the global frame (idle), or paced
 *   by distance covered (walk, run).
 *
 * Integers only: `actionFrame`, Q12 `vx`, frame counts. The clocks come from
 * the bake, through the sim context (`SimContext.bake`).
 */

import {
  AIR_DODGE_FRAMES,
  DASH_INTERRUPT_FRAME,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  JUMP_SQUAT_FRAMES,
  ROLL_FRAMES,
  SHIELD_BREAK_STUN,
  SHIELD_RELEASE_FRAMES,
  SPOT_DODGE_FRAMES,
} from "../constants";
import { ONE } from "../fixed";
import { jumpRiseSpeeds, type JumpKind } from "../kinetic";
import { fighterParams, type FighterParams } from "../params";
import {
  CROUCH_END_FRAMES,
  CROUCH_START_FRAMES,
  DOWNED_FRAMES,
  ENTRY_FRAMES,
  GETUP_FRAMES,
  LANDING_ANIMATION_FRAMES,
  LEDGE_GETUP_FRAMES,
  LEDGE_JUMP_FRAMES,
  LEDGE_ROLL_FRAMES,
  PUMMEL_FRAMES,
  RUN_BRAKE_FRAMES,
  SHIELD_START_FRAMES,
  TURNAROUND_FRAMES,
} from "../states";
import type { ActionState, FighterDef, FighterState } from "../types";
import { moveScriptFrame } from "./run";
import type { MotionKind } from "./types";

/** The fighter fields the clock reads. */
export type ClockedFighter = Pick<
  FighterState,
  "defId" | "action" | "actionFrame" | "move" | "port" | "charge" | "hitstun" | "jumpsUsed" | "fastFalling" | "vx" | "shortHop"
>;

export type ClockKind = "script" | "once" | "scaled" | "loop" | "idle" | "paced";

export interface MotionClock {
  readonly kind: ClockKind;
  /** Baked frames: the move's motion frames, a state's length, a cycle, or `SCALED_FRAMES`. */
  readonly frames: number;
}

/** Samples a variable-length state is baked at (60: exact for any length dividing 60). */
export const SCALED_FRAMES = 60;
/** World units one walk or run cycle covers (was `render/poses/timing.ts` STRIDE). */
export const STRIDE_UNITS = 36;
/** Idle is offset per port so four fighters do not breathe in lockstep. */
export const IDLE_PORT_OFFSET = 27;
/** A non-looping state with no length of its own is drawn across this many frames. */
export const OPEN_ENDED_FRAMES = 30;

/** The actions whose frames come from a `game_` script (was `simulate.ts` `hasLiveMove`). */
export function playsMoveScript(action: ActionState): boolean {
  return action === "attack" || action === "special" || action === "throw" || action === "grab" || action === "pummel";
}

/** The status motion for every non-move frame. */
export function statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling">): MotionKind {
  if (f.action === "jump" && f.jumpsUsed >= 2) return "status_jump_aerial";
  if ((f.action === "fall" || f.action === "dead") && f.fastFalling) return `status_${f.action}_fast`;
  return `status_${f.action}`;
}

/** The actions whose length depends on the fighter's state rather than a constant. */
export const VARIABLE_LENGTH_ACTIONS: ReadonlySet<ActionState> = new Set<ActionState>([
  "jump",
  "land",
  "landingLag",
  "airDodge",
  "hitstun",
]);

/**
 * Frames a jump rises for: the length of the engine's own rise
 * (`jumpRiseSpeeds`, Plan 2) — the same number `render/poses/timing.ts`
 * `jumpTimingFor` gives the 2D path, so the bake and both renderers agree.
 */
export function jumpRiseFrames(p: FighterParams, f: Pick<FighterState, "jumpsUsed" | "shortHop">): number {
  const kind: JumpKind = f.jumpsUsed >= 2 ? "air" : f.shortHop ? "short" : "full";
  return Math.max(1, jumpRiseSpeeds(p, kind, Math.max(0, f.jumpsUsed - 2)).length);
}

/**
 * How many frames the fighter's current state lasts, where knowable — the
 * state machine's own constants, imported rather than copied (DECISIONS D39),
 * as `render/poses/timing.ts` `actionDurationFor` reads them. Its own function
 * so the sim's hurtbox clock and the 3D renderer read one source.
 */
export function statusDuration(
  f: Pick<FighterState, "action" | "actionFrame" | "charge" | "hitstun" | "jumpsUsed" | "shortHop">,
  def?: FighterDef,
): number | undefined {
  switch (f.action) {
    case "jump":
      return def === undefined ? undefined : jumpRiseFrames(fighterParams(def), f);
    case "entering":
      return ENTRY_FRAMES;
    case "jumpSquat":
      return JUMP_SQUAT_FRAMES;
    case "land":
    case "landingLag":
      return f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES;
    case "crouchStart":
      return CROUCH_START_FRAMES;
    case "crouchEnd":
      return CROUCH_END_FRAMES;
    case "turnaround":
      return TURNAROUND_FRAMES;
    case "runBrake":
      return RUN_BRAKE_FRAMES;
    case "dashStart":
      return DASH_INTERRUPT_FRAME;
    case "shieldStart":
      return SHIELD_START_FRAMES;
    case "shieldRelease":
      return SHIELD_RELEASE_FRAMES;
    case "shieldBroken":
      return SHIELD_BREAK_STUN;
    case "spotDodge":
      return SPOT_DODGE_FRAMES;
    case "roll":
      return ROLL_FRAMES;
    case "ledgeRoll":
      return LEDGE_ROLL_FRAMES;
    case "airDodge":
      return f.charge === 1 ? DIRECTIONAL_AIR_DODGE_FRAMES : AIR_DODGE_FRAMES;
    case "downed":
      return DOWNED_FRAMES;
    case "getUp":
      return GETUP_FRAMES;
    case "ledgeGetUp":
      return LEDGE_GETUP_FRAMES;
    case "ledgeJump":
      return LEDGE_JUMP_FRAMES;
    case "pummel":
      return PUMMEL_FRAMES;
    case "hitstun":
      return f.actionFrame + f.hitstun;
    default:
      return undefined;
  }
}

/** Where a fighter's motion clocks come from: the bake (`BakeTables.clock`). */
export type ClockLookup = (fighterId: string, motion: MotionKind) => MotionClock | undefined;

/* --------------------------------------------------------------- clock -- */

export interface PoseIndex {
  readonly motion: MotionKind;
  /** 1-based, within `1..clock.frames`. */
  readonly frame: number;
}

const clampFrame = (n: number, frames: number): number => (n < 1 ? 1 : n > frames ? frames : n);
const wrap = (n: number, frames: number): number => (((n % frames) + frames) % frames) + 1;

/**
 * The (motion, frame) a fighter's bones are at, or null when no bake covers it
 * (callers fall back to the legacy single capsule / root bone).
 */
export function poseIndexOf(def: FighterDef, f: ClockedFighter, globalFrame: number, clockOf: ClockLookup): PoseIndex | null {
  if (f.move !== null && playsMoveScript(f.action)) {
    const run = moveScriptFrame(def, f);
    if (run === null) return null;
    const clock = clockOf(def.id, run.script.motion);
    if (clock === undefined) return null;
    return { motion: run.script.motion, frame: clampFrame(run.state.motionFrame, clock.frames) };
  }
  const motion = statusMotion(f);
  const clock = clockOf(def.id, motion);
  if (clock === undefined) return null;
  const af = f.actionFrame;
  switch (clock.kind) {
    case "script":
    case "once":
      return { motion, frame: clampFrame(af + 1, clock.frames) };
    case "scaled": {
      const d = statusDuration(f, def) ?? OPEN_ENDED_FRAMES;
      return { motion, frame: clampFrame(Math.floor((af * clock.frames) / Math.max(1, d)) + 1, clock.frames) };
    }
    case "loop":
      return { motion, frame: wrap(af, clock.frames) };
    case "idle":
      return { motion, frame: wrap(globalFrame + f.port * IDLE_PORT_OFFSET, clock.frames) };
    case "paced": {
      const speed = f.vx < 0 ? -f.vx : f.vx;
      return { motion, frame: wrap(Math.floor((af * speed * clock.frames) / (STRIDE_UNITS * ONE)), clock.frames) };
    }
  }
}

/** Normalised clip time for a baked frame — what the bake samples and the renderer draws. */
export function clipTimeOfFrame(clock: MotionClock, frame: number): number {
  return clock.frames <= 0 ? 0 : (frame - 1) / clock.frames;
}
```

`src/render/poses/timing.ts`: add `import { STRIDE_UNITS } from "@/engine/acmd/poseClock";` beside the `clipFor` import; change `const SLOT_POSE: Record<MoveSlot, PoseName> = {` to `export const SLOT_POSE: Record<MoveSlot, PoseName> = {`; change `const STRIDE = 36;` to `const STRIDE = STRIDE_UNITS;` (keep its comment); change `const PACED_BY_SPEED: Partial<Record<PoseName, true>> = …` to `export const PACED_BY_SPEED: …`. Nothing else in the 2D timing changes.

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/acmd/poseClock.test.ts src/engine/layering.test.ts src/render/poses`
Expected: PASS (poseClock 7 tests; layering unchanged — `poseClock.ts` uses `Math.floor`/`Math.max` on integers only).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. Golden trace untouched (nothing in `step()` reads the clock yet).

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/engine/acmd/poseClock.ts super-smash/src/engine/acmd/poseClock.test.ts super-smash/src/render/poses/timing.ts
git commit -m "super-smash: the pose clock — which baked motion frame a fighter is on, in integers" -m "Moves index the bake by the script's motion frame; statuses play status_<action> once, scaled, looping, on the match clock (idle) or paced by distance (walk, run). One function for the sim's hurtboxes and the 3D renderer." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The bone bake — every motion, every frame, every bone the sim reads

For each fighter, each move slot plays its active script's motion for as many motion frames as the move lasts, timed so the clip's strike key lands on the script's first active motion frame (`attackClipTime`, D34 in motion frames); each status plays its clip on Task 9's clock. Every frame's 2D sample is retargeted (Task 3), run through FK and projected (Task 4) for the bones the sim reads: the hurt-capsule bones and every bone a script names that the skeleton has (`top` stays Plan 2's). The output is one little-endian file, `public/bake/roster.bin.gz`: per fighter its bone names, hurt capsules (Q12), and per motion its clock and `frames × bones × 8` values on the 1/256-unit grid, stored as int16 frame-to-frame deltas. Measured on the eight committed skeletons (Task 6, sword and tail bones included): 5,453,163 bytes raw, 1,575,058 gzipped (on the invented test skeleton int32 Q12 was 9.6 MB / 3.4 MB); the test's budget is 2 MB / 8 MB. The fingerprint is the SHA-256 of the *uncompressed* bytes, compiled into `src/fighters/bake/digest.ts`, so it does not depend on the gzip implementation. Baking takes ~0.4 s; `roster.test.ts` re-bakes and compares on every run.

**Files:**
- Create: `super-smash/src/engine/acmd/bakeCodec.ts` (replaces Task 3's one-line stub), `super-smash/src/engine/acmd/bakeCodec.test.ts`, `super-smash/src/engine/acmd/bakeTables.ts`, `super-smash/src/render3d/bake/bake.ts`, `super-smash/src/render3d/bake/roster.test.ts`, `super-smash/src/fighters/bake/digest.ts`, `super-smash/public/bake/roster.bin.gz` (generated)
- Modify: `super-smash/src/render3d/bake/roster.ts` (adds `bakeRoster`; Task 13 makes it bake the game's fighters, limb-bone scripts on)

**Interfaces:**
- Produces (`acmd/bakeCodec.ts`): `BAKE_QUANTUM = 16`, `BoneHurtbox { bone; x1; x2; r }` (Q12), `BakedFighter { bones: BakedFighterBones; clocks: Record<MotionKind, MotionClock>; hurt: BoneHurtbox[] }`, `encodeBake(fighters): Uint8Array`, `decodeBake(bytes): BakedFighter[]` (magic `DSB2`).
- Produces (`acmd/bakeTables.ts`): `BakeTables { bones: BoneTable (fingerprint = first 8 hex of the digest); clock(fighterId, motion); hurtboxes(fighterId); fingerprint }`, `bakeTables(fighters, fingerprint)`, `LEGACY_BAKE` (root bone only, no clocks, no hurtboxes).
- Produces (`render3d/bake/bake.ts`): `attackClipTime(strike, firstActive, frames, k)`, `ScriptTiming`, `scriptTiming(script, totalGameFrames)`, `statusClock(clip, poseName, action)`, `StatusMotionSpec`, `statusMotionSpecs()`, `FighterBakeInput`, `FighterPoser { fighterId; rig3; cal; rig2d; rigScale2d; scale }`, `fighterPoser(def, skeleton)`, `rootXformOf(poser, sample)`, `poseWorld(poser, sample, spin)`, `MotionSampler { clip; clock; time(k) }`, `moveSamplers(def)`, `statusSamplers(def)`, `motionSamplers(def)`, `sampleAt(sampler, k): { sample; spin }`, `bakeFighter(input): BakedFighter`.
- Produces (`render3d/bake/roster.ts`): `bakeRoster(skeletons): BakedFighter[]` (throws `bake: no committed skeleton for <id>`).
- Produces (`src/fighters/bake/digest.ts`, generated): `BAKE_DIGEST: string` (64 hex), `BAKE_BYTES: number`.
- Command: `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts`. **Every later change to a clip in `src/render/poses/**` or `chars/*/poses.ts`, to a skeleton, to a fighter's moves or scripts, or to the retargeter must regenerate the bake in the same commit**; `roster.test.ts` fails until it does.

- [ ] **Step 1: Write the failing tests** — `src/engine/acmd/bakeCodec.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BAKE_QUANTUM, decodeBake, encodeBake, type BakedFighter } from "./bakeCodec";
import { bakeTables } from "./bakeTables";
import { BONE_POSE_STRIDE, TOP_POSE, newBonePose, type BoneTable } from "./bones";

const get = (t: BoneTable, f: string, m: string, fr: number, b: string) => {
  const out = newBonePose();
  return t.pose(f, m, fr, b, out) ? out : null;
};

function fighter(): BakedFighter {
  const bones = ["hip", "kneer"];
  const frames = 3;
  const data = new Int32Array(frames * bones.length * BONE_POSE_STRIDE);
  for (let i = 0; i < data.length; i++) data[i] = ((i * 37) % 4001 - 2000) * BAKE_QUANTUM;
  return {
    bones: { fighter: "mario", bones, motions: { attack_air_n: { frames, data }, status_stand: { frames, data: data.map((v) => -v) } } },
    clocks: { attack_air_n: { kind: "script", frames }, status_stand: { kind: "idle", frames } },
    hurt: [{ bone: "kneer", x1: 0, x2: 4096 * 2, r: 4096 }],
  };
}

describe("the bake's file format", () => {
  it("round-trips every number, clock and hurtbox exactly", () => {
    const f = fighter();
    const [back] = decodeBake(encodeBake([f]));
    expect(back.bones.bones).toEqual(f.bones.bones);
    expect(Array.from(back.bones.motions.attack_air_n.data)).toEqual(Array.from(f.bones.motions.attack_air_n.data));
    expect(back.clocks).toEqual(f.clocks);
    expect(back.hurt).toEqual(f.hurt);
  });

  it("is byte-for-byte deterministic, whatever order the motions were baked in", () => {
    const f = fighter();
    const reordered: BakedFighter = { ...f, bones: { ...f.bones, motions: { status_stand: f.bones.motions.status_stand, attack_air_n: f.bones.motions.attack_air_n } } };
    expect(encodeBake([reordered])).toEqual(encodeBake([f]));
  });

  it("refuses a value off the 1/256 grid, a truncated file and a foreign file — loudly", () => {
    const f = fighter();
    const off = { ...f, bones: { ...f.bones, motions: { ...f.bones.motions, attack_air_n: { frames: 3, data: f.bones.motions.attack_air_n.data.map((v, i) => (i === 5 ? v + 1 : v)) } } } };
    expect(() => encodeBake([off])).toThrow(/not on the 16-unit grid/);
    const bytes = encodeBake([f]);
    expect(() => decodeBake(bytes.slice(0, bytes.length - 3))).toThrow(/truncated/);
    expect(() => decodeBake(new TextEncoder().encode("PNG!...."))).toThrow(/not a David-Smash bake/);
  });

  it("answers baked limbs from the bake and the root bone from Plan 2's table", () => {
    const t = bakeTables(decodeBake(encodeBake([fighter()])), "test");
    expect(get(t.bones, "mario", "attack_air_n", 2, "kneer")).not.toBeNull();
    expect(get(t.bones, "mario", "attack_air_n", 2, "top")).toEqual(TOP_POSE);
    expect(get(t.bones, "fox", "attack_air_n", 2, "kneer")).toBeNull();
    expect(t.clock("mario", "status_stand")).toEqual({ kind: "idle", frames: 3 });
    expect(t.hurtboxes("fox")).toBeUndefined();
  });
});
```

`src/render3d/bake/roster.test.ts` (Task 13 adds one test):

```ts
// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { decodeBake, encodeBake } from "@/engine/acmd/bakeCodec";
import { BAKE_BYTES, BAKE_DIGEST } from "@/fighters/bake/digest";
import { SKELETONS } from "../skeletons";
import { bakeRoster } from "./roster";

/**
 * The bake, kept honest (Plan 4 Task 10).
 *
 * Every clip, script and skeleton the sim's bones depend on is baked fresh here
 * and compared with the committed `public/bake/roster.bin.gz`; any change to
 * them must regenerate it, and the commit says why:
 *
 *   UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
 *
 * The digest is of the uncompressed bytes, so a different zlib cannot fail it.
 */

const ROOT = process.cwd();
const FILE = join(ROOT, "public", "bake", "roster.bin.gz");
const DIGEST = join(ROOT, "src", "fighters", "bake", "digest.ts");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("the committed bake", () => {
  const fresh = encodeBake(bakeRoster(SKELETONS));

  if (process.env.UPDATE_BAKE === "1") {
    it("writes public/bake/roster.bin.gz and its digest", () => {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, gzipSync(fresh, { level: 9 }));
      writeFileSync(
        DIGEST,
        "// GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.\n" +
          `/** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */\n` +
          `export const BAKE_DIGEST = "${sha256(fresh)}";\n` +
          `/** Its uncompressed length in bytes. */\n` +
          `export const BAKE_BYTES = ${fresh.length};\n`,
      );
      expect(existsSync(FILE)).toBe(true);
    });
    return;
  }

  it("is exactly what the current clips, scripts and skeletons bake to", () => {
    const committed = gunzipSync(readFileSync(FILE));
    expect(committed.length).toBe(fresh.length);
    expect(sha256(committed)).toBe(sha256(fresh));
  });

  it("matches the digest the client checks it against", () => {
    expect(sha256(fresh)).toBe(BAKE_DIGEST);
    expect(fresh.length).toBe(BAKE_BYTES);
  });

  it("round-trips through the decoder bit for bit", () => {
    expect(encodeBake(decodeBake(fresh))).toEqual(fresh);
  });

  it("stays within its size budget (2 MB gzipped, 8 MB uncompressed)", () => {
    // Measured on the committed skeletons, sword and tail bones included:
    // 1.58 MB / 5.46 MB. Past this budget, bake fewer bones, not a bigger file.
    expect(readFileSync(FILE).length).toBeLessThan(2 * 1024 * 1024);
    expect(fresh.length).toBeLessThan(8 * 1024 * 1024);
  });
}, 120_000);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/engine/acmd/bakeCodec.test.ts src/render3d/bake/roster.test.ts`
Expected: FAIL — `bakeCodec.test.ts`: `Error: Failed to resolve import "./bakeTables" from "src/engine/acmd/bakeCodec.test.ts". Does the file exist?`; `roster.test.ts` (a node-environment test, so Node's resolver reports it): `Error: Cannot find package '@/fighters/bake/digest' imported from …/src/render3d/bake/roster.test.ts`.

- [ ] **Step 3: Implement** — `src/engine/acmd/bakeCodec.ts` (replacing the stub):

```ts
/**
 * The bake's file format: every fighter's baked bones, motion clocks,
 * hurtboxes and ECB in one little-endian binary (Plan 4).
 *
 * Committed gzipped as `public/bake/roster.bin.gz` (1.58 MB on the committed skeletons); its fingerprint
 * is the SHA-256 of the *uncompressed* bytes (`src/fighters/bake/digest.ts`),
 * so it does not depend on the compressor, and two peers whose fingerprints
 * differ refuse to start an online match together. Derived numbers only — the
 * bone transforms of our own clips on SSBU's skeleton proportions.
 *
 * Layout (integers little-endian):
 *   "DSB2"  u16 fighterCount
 *   per fighter:
 *     str id   u8 boneCount  str[boneCount] bone names (lower case)
 *     u8 hurtCount  { u8 boneIndex, i32 x1, i32 x2, i32 r }[hurtCount]   (Q12)
 *     u16 motionCount
 *     per motion: str name  u8 clockKind  u16 frames
 *                 i16[frames · bones · 8]: pose values in BAKE_QUANTUM units,
 *                 frame 1 absolute, every later frame the difference from the
 *                 same value one frame earlier (they compress ~3× better).
 *   str = u8 length + printable ASCII.
 *
 * Integers only, so decoding is identical on every engine — which is why it may
 * live in `engine/`.
 */

import type { BakedFighterBones, BakedMotion } from "./bones";
import { BONE_POSE_STRIDE } from "./bones";
import type { ClockKind, MotionClock } from "./poseClock";
import type { BoneName, MotionKind } from "./types";

/** Baked pose values are multiples of this many Q12 units (1/256 of a unit). */
export const BAKE_QUANTUM = 16;

export interface BoneHurtbox {
  readonly bone: BoneName;
  /** Bone-local segment along +X, and radius, Q12. UNVERIFIED: derived from mesh weights. */
  readonly x1: number;
  readonly x2: number;
  readonly r: number;
}

export interface BakedFighter {
  readonly bones: BakedFighterBones;
  readonly clocks: Readonly<Record<MotionKind, MotionClock>>;
  readonly hurt: readonly BoneHurtbox[];
}

const MAGIC = "DSB2";
const KINDS: readonly ClockKind[] = ["script", "once", "scaled", "loop", "idle", "paced"];

function check(ok: boolean, why: string): void {
  if (!ok) throw new Error(`bake: ${why}`);
}

export function encodeBake(fighters: readonly BakedFighter[]): Uint8Array {
  let size = 6;
  for (const f of fighters) {
    size += 1 + f.bones.fighter.length + 1 + f.bones.bones.reduce((s, b) => s + 1 + b.length, 0);
    size += 1 + f.hurt.length * 13 + 2;
    for (const [name, m] of Object.entries(f.bones.motions)) size += 1 + name.length + 3 + m.data.length * 2;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u8 = (v: number) => {
    check(Number.isInteger(v) && v >= 0 && v <= 0xff, `${v} does not fit a u8`);
    out[at++] = v;
  };
  const u16 = (v: number) => {
    check(Number.isInteger(v) && v >= 0 && v <= 0xffff, `${v} does not fit a u16`);
    view.setUint16(at, v, true);
    at += 2;
  };
  const i32 = (v: number) => {
    check(Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff, `${v} does not fit an i32`);
    view.setInt32(at, v, true);
    at += 4;
  };
  const str = (s: string) => {
    check(/^[\x20-\x7e]*$/.test(s) && s.length <= 0xff, `"${s}" is not a short printable ASCII name`);
    u8(s.length);
    for (let i = 0; i < s.length; i++) out[at++] = s.charCodeAt(i);
  };

  for (const c of MAGIC) u8(c.charCodeAt(0));
  u16(fighters.length);
  for (const f of fighters) {
    const id = f.bones.fighter;
    const bones = f.bones.bones;
    str(id);
    u8(bones.length);
    for (const b of bones) str(b);
    u8(f.hurt.length);
    for (const h of f.hurt) {
      const i = bones.indexOf(h.bone);
      check(i >= 0, `${id}: hurtbox on unbaked bone ${h.bone}`);
      u8(i);
      i32(h.x1);
      i32(h.x2);
      i32(h.r);
    }
    const motions = Object.keys(f.bones.motions).sort();
    u16(motions.length);
    for (const name of motions) {
      const m = f.bones.motions[name];
      const clock = f.clocks[name];
      check(clock !== undefined && clock.frames === m.frames, `${id}/${name} has no matching clock`);
      const stride = bones.length * BONE_POSE_STRIDE;
      check(m.data.length === m.frames * stride, `${id}/${name} has ${m.data.length} values for ${m.frames} frames`);
      str(name);
      u8(KINDS.indexOf(clock.kind));
      u16(m.frames);
      for (let i = 0; i < m.data.length; i++) {
        const v = m.data[i];
        check(v % BAKE_QUANTUM === 0, `${id}/${name} value ${v} is not on the ${BAKE_QUANTUM}-unit grid`);
        const d = (i < stride ? v : v - m.data[i - stride]) / BAKE_QUANTUM;
        check(d >= -0x8000 && d <= 0x7fff, `${id}/${name} step ${d} does not fit an i16`);
        view.setInt16(at, d, true);
        at += 2;
      }
    }
  }
  check(at === size, `wrote ${at} of ${size} bytes`);
  return out;
}

export function decodeBake(bytes: Uint8Array): BakedFighter[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number) => check(at + n <= bytes.length, `truncated at byte ${at}`);
  const u8 = () => (need(1), bytes[at++]);
  const u16 = () => {
    need(2);
    const v = view.getUint16(at, true);
    at += 2;
    return v;
  };
  const i32 = () => {
    need(4);
    const v = view.getInt32(at, true);
    at += 4;
    return v;
  };
  const str = () => {
    const n = u8();
    need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[at + i]);
    at += n;
    return s;
  };

  let magic = "";
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(u8());
  check(magic === MAGIC, `not a David-Smash bake (magic "${magic}")`);
  const out: BakedFighter[] = [];
  const count = u16();
  for (let fi = 0; fi < count; fi++) {
    const fighter = str();
    const nb = u8();
    const bones: string[] = [];
    for (let i = 0; i < nb; i++) bones.push(str());
    const nh = u8();
    const hurt: BoneHurtbox[] = [];
    for (let i = 0; i < nh; i++) {
      const bone = bones[u8()];
      check(bone !== undefined, `${fighter}: hurtbox bone index out of range`);
      hurt.push({ bone, x1: i32(), x2: i32(), r: i32() });
    }
    const motions: Record<MotionKind, BakedMotion> = {};
    const clocks: Record<MotionKind, MotionClock> = {};
    const nm = u16();
    const stride = nb * BONE_POSE_STRIDE;
    for (let mi = 0; mi < nm; mi++) {
      const name = str();
      const kind = KINDS[u8()];
      check(kind !== undefined, `${fighter}/${name}: unknown clock kind`);
      const frames = u16();
      const n = frames * stride;
      need(n * 2);
      const data = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const d = view.getInt16(at + i * 2, true) * BAKE_QUANTUM;
        data[i] = i < stride ? d : data[i - stride] + d;
      }
      at += n * 2;
      motions[name] = { frames, data };
      clocks[name] = { kind, frames };
    }
    out.push({ bones: { fighter, bones, motions }, clocks, hurt });
  }
  check(at === bytes.length, `${bytes.length - at} trailing bytes`);
  return out;
}
```

`src/engine/acmd/bakeTables.ts`:

```ts
/**
 * The decoded bake, as the sim reads it: the layered bone table (baked limbs
 * over Plan 2's root bone), the motion clocks, and the per-bone hurtboxes —
 * plus the fingerprint two online peers compare before a match.
 *
 * Built once at start-up (`game/bake.ts`) and handed to the sim through its
 * context; nothing here is mutable, so `cloneState`/`hashState` never see it.
 */

import { bakedBoneTable, layeredBoneTable, LEGACY_BONE_TABLE, type BoneTable } from "./bones";
import type { BakedFighter, BoneHurtbox } from "./bakeCodec";
import type { MotionClock } from "./poseClock";
import type { MotionKind } from "./types";

export interface BakeTables {
  /** Baked limbs over Plan 2's root bone; its `fingerprint` is the bake's (8 hex). */
  readonly bones: BoneTable;
  clock(fighterId: string, motion: MotionKind): MotionClock | undefined;
  hurtboxes(fighterId: string): readonly BoneHurtbox[] | undefined;
  /** SHA-256 (hex) of the uncompressed roster file; "legacy" with no bake. */
  readonly fingerprint: string;
}

export function bakeTables(fighters: readonly BakedFighter[], fingerprint: string): BakeTables {
  const clocks = new Map(fighters.map((f) => [f.bones.fighter, new Map(Object.entries(f.clocks))]));
  const hurt = new Map(fighters.map((f) => [f.bones.fighter, f.hurt]));
  const layered = layeredBoneTable(bakedBoneTable(fighters.map((f) => f.bones)), LEGACY_BONE_TABLE);
  return {
    // The online handshake compares this (Plan 2 `engineFingerprint`): two
    // peers on different bakes would put hitboxes in different places.
    bones: { fingerprint: fingerprint.slice(0, 8), pose: (id, motion, frame, bone, out) => layered.pose(id, motion, frame, bone, out) },
    clock: (id, motion) => clocks.get(id)?.get(motion),
    hurtboxes: (id) => hurt.get(id),
    fingerprint,
  };
}

/** No bake: the root bone only, one capsule per fighter (Plan 2 behaviour). */
export const LEGACY_BAKE: BakeTables = {
  bones: LEGACY_BONE_TABLE,
  clock: () => undefined,
  hurtboxes: () => undefined,
  fingerprint: "legacy",
};
```

If Plan 2's `layeredBoneTable` already returns a `fingerprint` built from its parts, this wrapper still overrides it with the bake's digest: one stable 8-hex value is what `engineFingerprint` and `OnlineMatchConfig.bones` compare.

`src/render3d/bake/bake.ts`:

```ts
/**
 * The bone bake: every motion the sim can be in, every frame, every bone the sim
 * reads, as Q12 integers (spec §3.1, research R§2 "root-cause fix").
 *
 * For each fighter:
 * - each move slot plays its active `game_` script's motion for as many motion
 *   frames as the move lasts; the clip is the slot's (`SLOT_POSE`, with the
 *   fighter's own override), timed so its strike key lands on the script's
 *   first active motion frame (`attackClipTime`, DECISIONS D34);
 * - each status plays `status_<action>` on the clock `statusClock` picks;
 * - each frame's 2D pose sample is retargeted onto the fighter's SSBU skeleton
 *   (`retarget.ts`), run through forward kinematics (`fk.ts`) and projected onto
 *   the side plane.
 *
 * The renderer evaluates exactly the same functions for the frame it draws
 * (`render3d/fighterPose.ts`), so a hitbox hangs off the limb the player sees.
 * Float maths happens here, at build time; the sim only ever reads the integers.
 */

import { BONE_POSE_STRIDE, type BakedMotion } from "@/engine/acmd/bones";
import type { BakedFighter, BoneHurtbox } from "@/engine/acmd/bakeCodec";
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import {
  OPEN_ENDED_FRAMES,
  SCALED_FRAMES,
  VARIABLE_LENGTH_ACTIONS,
  statusDuration,
  statusMotion,
  type MotionClock,
} from "@/engine/acmd/poseClock";
import type { AcmdScript, MotionKind } from "@/engine/acmd/types";
import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { ONE, toFloat } from "@/engine/fixed";
import { fighterParams } from "@/engine/params";
import { STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import type { ActionState, FighterDef, FighterState, MoveSlot } from "@/engine/types";
import { clipFor, getCharacterRig } from "@/render/chars";
import { PACED_BY_SPEED, SLOT_POSE, poseNameFor } from "@/render/poses/timing";
import { samplePose, type PoseClip, type PoseSample } from "@/render/poses/clip";
import type { Rig } from "@/render/skeleton";
import { buildRig, type Rig3, type SkeletonFile } from "../skeleton/skeleton";
import { calibrate, retarget, type Calibration } from "../retarget/retarget";
import { sideBonePose, worldMatrices, type RootXform } from "./fk";

/* --------------------------------------------------------- clip timing -- */

/**
 * Normalised clip time on motion frame `k` (1-based) of a move lasting `frames`
 * motion frames whose first hitbox is live on motion frame `firstActive` — the
 * two-piece map of `poseTimeFor` (D34), in motion frames.
 */
export function attackClipTime(strike: number | undefined, firstActive: number, frames: number, k: number): number {
  const f = k - 1;
  const first = firstActive - 1;
  if (strike !== undefined && first > 0 && first < frames) {
    return f <= first ? (strike * f) / first : Math.min(1, strike + ((1 - strike) * (f - first)) / (frames - first));
  }
  return frames <= 0 ? 0 : Math.min(1, f / frames);
}

export interface ScriptTiming {
  /** Motion frames the move lasts. */
  readonly frames: number;
  /** First motion frame with a live ATTACK or CATCH, or −1. */
  readonly firstActive: number;
}

/** A move's length and contact frame in motion frames, read off its script over its game frames. */
export function scriptTiming(script: AcmdScript, totalGameFrames: number): ScriptTiming {
  let frames = 1;
  let firstActive = -1;
  for (let g = 1; g <= Math.max(1, totalGameFrames); g++) {
    const st = runScript(script, g);
    if (st.motionFrame > frames) frames = st.motionFrame;
    if (firstActive < 0 && st.attacks.length + st.catches.length > 0) firstActive = st.motionFrame;
  }
  return { frames, firstActive };
}

/** The clock a status motion is baked on, from its clip and its state's length. */
export function statusClock(clip: PoseClip, poseName: string, action: ActionState): MotionClock {
  if (clip.loop) {
    const frames = clip.period ?? 30;
    if (poseName === "idle") return { kind: "idle", frames };
    if (PACED_BY_SPEED[poseName as keyof typeof PACED_BY_SPEED]) return { kind: "paced", frames };
    return { kind: "loop", frames };
  }
  if (VARIABLE_LENGTH_ACTIONS.has(action)) return { kind: "scaled", frames: SCALED_FRAMES };
  const d = statusDuration({ action, actionFrame: 0, charge: 0, hitstun: 0, jumpsUsed: 1, shortHop: false });
  return { kind: "once", frames: d ?? OPEN_ENDED_FRAMES };
}

/** One status motion: which action (and variant) it stands for. */
export interface StatusMotionSpec {
  readonly motion: MotionKind;
  readonly action: ActionState;
  readonly jumpsUsed: number;
  readonly fastFalling: boolean;
}

/** Every status motion `statusMotion` can return. */
export function statusMotionSpecs(): StatusMotionSpec[] {
  const out: StatusMotionSpec[] = [];
  for (const action of Object.keys(STATUS_KIND_OF_ACTION) as ActionState[]) {
    for (const v of [
      { jumpsUsed: 1, fastFalling: false },
      { jumpsUsed: 2, fastFalling: false },
      { jumpsUsed: 1, fastFalling: true },
    ]) {
      const motion = statusMotion({ action, ...v });
      if (!out.some((s) => s.motion === motion)) out.push({ motion, action, ...v });
    }
  }
  return out;
}

/** A fighter standing in for the pose layer's questions about a status. */
function posed(spec: StatusMotionSpec, defId: string): FighterState {
  return {
    defId,
    action: spec.action,
    actionFrame: 0,
    move: null,
    jumpsUsed: spec.jumpsUsed,
    fastFalling: spec.fastFalling,
  } as unknown as FighterState;
}

/* --------------------------------------------------------------- input -- */

export interface FighterBakeInput {
  readonly def: FighterDef;
  readonly skeleton: SkeletonFile;
  /** Lower-case bones scripts may name for this fighter (active and reference scripts). */
  readonly scriptBones: ReadonlySet<string>;
}

/** Everything one fighter's poses depend on, prepared once. */
export interface FighterPoser {
  readonly fighterId: string;
  readonly rig3: Rig3;
  readonly cal: Calibration;
  readonly rig2d: Rig;
  /** 2D rig units → world units, for clip offsets. */
  readonly rigScale2d: number;
  /** `FighterParams.scale` as a float. */
  readonly scale: number;
}

export function fighterPoser(def: FighterDef, skeleton: SkeletonFile): FighterPoser {
  const rig3 = buildRig(skeleton);
  const character = getCharacterRig(def.id);
  return {
    fighterId: def.id,
    rig3,
    cal: calibrate(rig3, character.bones),
    rig2d: character.bones,
    rigScale2d: character.scale,
    scale: toFloat(fighterParams(def).scale),
  };
}

/** The root transform a pose sample asks for (offsets and squash), at the fighter's size. */
export function rootXformOf(p: FighterPoser, s: PoseSample): RootXform {
  return {
    forward: s.offsetX * p.rigScale2d,
    up: s.offsetY * p.rigScale2d,
    squashForward: s.scaleX,
    squashUp: s.scaleY,
    scale: p.scale,
  };
}

/** World matrices of every bone for a pose sample plus a clip spin (radians). */
export function poseWorld(p: FighterPoser, s: PoseSample, spin: number): number[][] {
  return worldMatrices(p.rig3, retarget(p.cal, p.rig2d, s.angles, s.rotation + spin), rootXformOf(p, s));
}

/** The clip sample and spin a motion plays on its baked frame `k`. */
export interface MotionSampler {
  readonly clip: PoseClip;
  readonly clock: MotionClock;
  readonly time: (k: number) => number;
}

/** The sampler for each slot's active script motion. */
export function moveSamplers(def: FighterDef): Map<MotionKind, MotionSampler & { slot: MoveSlot }> {
  const out = new Map<MotionKind, MotionSampler & { slot: MoveSlot }>();
  for (const slot of Object.keys(def.moves) as MoveSlot[]) {
    const move = def.moves[slot];
    const script = gameScriptFor(def, slot);
    if (move === undefined || script === null) continue;
    if (out.has(script.motion)) throw new Error(`bake ${def.id}: slots ${out.get(script.motion)!.slot} and ${slot} share motion ${script.motion}`);
    const clip = clipFor(def.id, SLOT_POSE[slot]);
    const timing = scriptTiming(script, move.totalFrames);
    out.set(script.motion, {
      slot,
      clip,
      clock: { kind: "script", frames: timing.frames },
      time: (k) => attackClipTime(clip.strike, timing.firstActive, timing.frames, k),
    });
  }
  return out;
}

/** The sampler for each status motion. */
export function statusSamplers(def: FighterDef): Map<MotionKind, MotionSampler> {
  const out = new Map<MotionKind, MotionSampler>();
  for (const spec of statusMotionSpecs()) {
    const poseName = poseNameFor(posed(spec, def.id));
    const clip = clipFor(def.id, poseName);
    const clock = statusClock(clip, poseName, spec.action);
    out.set(spec.motion, { clip, clock, time: (k) => (k - 1) / clock.frames });
  }
  return out;
}

/** Every motion's sampler, moves first (a move motion never collides with `status_*`). */
export function motionSamplers(def: FighterDef): Map<MotionKind, MotionSampler> {
  return new Map<MotionKind, MotionSampler>([...moveSamplers(def), ...statusSamplers(def)]);
}

/** Clip sample and spin for a sampler's frame. */
export function sampleAt(s: MotionSampler, k: number): { sample: PoseSample; spin: number } {
  const t = s.time(k);
  return { sample: samplePose(s.clip, t), spin: (s.clip.spin ?? 0) * t * Math.PI * 2 };
}

/* ---------------------------------------------------------------- bake -- */

const q12 = (v: number): number => Math.round(v * ONE);

export function bakeFighter(input: FighterBakeInput): BakedFighter {
  const { def, skeleton } = input;
  const p = fighterPoser(def, skeleton);
  const lowerOf = (i: number) => p.rig3.names[i].toLowerCase();

  // The bones the sim reads: hurtbox bones and every bone a script names that
  // this skeleton has. A bone an *active* script names but the skeleton lacks is
  // an error: `scriptHitboxes` would throw mid-match.
  const wanted = new Set<string>(skeleton.hurt.map((h) => h.bone.toLowerCase()));
  for (const b of input.scriptBones) if (p.rig3.byLower.has(b)) wanted.add(b);
  for (const slot of Object.keys(def.moves) as MoveSlot[]) {
    const script = gameScriptFor(def, slot);
    if (script === null) continue;
    for (const bone of scriptBoneNames(script.commands)) {
      if (!p.rig3.byLower.has(bone)) throw new Error(`bake ${def.id}: ${script.name} uses bone "${bone}", which the skeleton lacks`);
      wanted.add(bone);
    }
  }
  const boneIdx = [...wanted].map((b) => p.rig3.byLower.get(b)!).sort((a, b) => a - b);
  const bones = boneIdx.map(lowerOf);

  const motions: Record<MotionKind, BakedMotion> = {};
  const clocks: Record<MotionKind, MotionClock> = {};
  for (const [motion, sampler] of motionSamplers(def)) {
    const frames = sampler.clock.frames;
    const data = new Int32Array(frames * bones.length * BONE_POSE_STRIDE);
    for (let k = 1; k <= frames; k++) {
      const { sample, spin } = sampleAt(sampler, k);
      const world = poseWorld(p, sample, spin);
      boneIdx.forEach((bi, j) => {
        const pose = sideBonePose(world[bi]);
        data.set([pose.tx, pose.ty, pose.m00, pose.m01, pose.m02, pose.m10, pose.m11, pose.m12], ((k - 1) * bones.length + j) * BONE_POSE_STRIDE);
      });
    }
    motions[motion] = { frames, data };
    clocks[motion] = sampler.clock;
  }

  const hurt: BoneHurtbox[] = skeleton.hurt.map((h) => ({
    bone: h.bone.toLowerCase(),
    x1: q12(h.x1),
    x2: q12(h.x2),
    r: q12(h.r * p.scale),
  }));

  return { bones: { fighter: def.id, bones, motions }, clocks, hurt };
}
```

`src/render3d/bake/roster.ts` (whole file now):

```ts
/**
 * The whole roster's bake, from the committed skeletons (`src/render3d/skeletons/`)
 * and the fighters as the game plays them (Task 13 adds their limb-bone scripts). `roster.test.ts` writes it to
 * `public/bake/roster.bin.gz` under `UPDATE_BAKE=1` and otherwise proves the
 * committed file is exactly what the current clips, scripts and skeletons bake to.
 */

import type { BakedFighter } from "@/engine/acmd/bakeCodec";
import { FIGHTERS } from "@/fighters";
import { REFERENCE_SCRIPTS } from "@/fighters/acmd";
import type { SkeletonFile } from "../skeleton/skeleton";
import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { bakeFighter } from "./bake";

/** Every bone any of a fighter's reference scripts names (lower case, `top` excluded). */
export function referenceScriptBones(fighterId: string): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(REFERENCE_SCRIPTS[fighterId]?.scripts ?? {})) {
    for (const b of scriptBoneNames(s.commands)) out.add(b);
  }
  return out;
}

export function bakeRoster(skeletons: Readonly<Record<string, SkeletonFile>>): BakedFighter[] {
  return FIGHTERS.map((def) => {
    const skeleton = skeletons[def.id];
    if (skeleton === undefined) throw new Error(`bake: no committed skeleton for ${def.id} (run pnpm models)`);
    return bakeFighter({ def, skeleton, scriptBones: referenceScriptBones(def.id) });
  });
}
```

`src/fighters/bake/digest.ts` (placeholder values the generator overwrites in Step 4):

```ts
// GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
/** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
export const BAKE_DIGEST = "";
/** Its uncompressed length in bytes. */
export const BAKE_BYTES = 0;
```

- [ ] **Step 4: Generate the bake, then run the tests**

Run: `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts`
Expected: PASS (1 test, "writes public/bake/roster.bin.gz and its digest"; it creates `public/bake/`). `src/fighters/bake/digest.ts` now reads `BAKE_DIGEST = "66c2f7af59880c467a401fd75923e226e3f1a7e8b75a772a879ac594294f9420"` and `BAKE_BYTES = 5453163` — the values verified in scratch from the committed skeletons; a different digest means a different clip, skeleton or retargeter, so find out which before committing.

Run: `pnpm vitest run src/engine/acmd/bakeCodec.test.ts src/render3d/bake/roster.test.ts && ls -l public/bake/roster.bin.gz`
Expected: PASS (codec 4 tests, roster 4 tests); the file is 1,575,058 bytes (gzip level 9 on Node 26's zlib; the digest, not the gzip size, is what is checked).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. Golden trace untouched (nothing reads the bake yet).

- [ ] **Step 6: Commit** (derived numbers: our clips' bone transforms on SSBU proportions; no mesh, no texture)

```bash
git add super-smash/src/engine/acmd/bakeCodec.ts super-smash/src/engine/acmd/bakeCodec.test.ts super-smash/src/engine/acmd/bakeTables.ts super-smash/src/render3d/bake/bake.ts super-smash/src/render3d/bake/roster.ts super-smash/src/render3d/bake/roster.test.ts super-smash/src/fighters/bake/digest.ts super-smash/public/bake/roster.bin.gz
git commit -m "super-smash: bake every motion's bones into integer tables at build time" -m "Each move's script motion and each status's clip, every frame, retargeted onto the fighter's committed skeleton, through FK, onto the side plane, on a 1/256-unit grid: public/bake/roster.bin.gz (1.58 MB gzipped, 5.45 MB raw), fingerprinted by the SHA-256 of its uncompressed bytes. roster.test.ts re-bakes on every run, so a clip change without a re-bake fails." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Load the bake and install it in the game's context

`public/bake/roster.bin.gz` is fetched once per page, gunzipped with `DecompressionStream`, checked against `BAKE_DIGEST` and decoded into `BakeTables`, then installed in Plan 2's `GAME_SIM_CONTEXT`: `bones` (hitboxes, and the 8-hex fingerprint `engineFingerprint` puts in `OnlineMatchConfig.bones`) and the new `SimContext.bake` (clocks and hurtboxes). Two peers on different bakes therefore refuse to start (Plan 2's `engine-mismatch`). `registryContext` stays on Plan 2's root bone, so unit tests that step without a context are unchanged; tests that want the game's world build it with `bakedContext(base, readBakeFromDisk())`.

**Files:**
- Create: `super-smash/src/game/bake.ts`, `super-smash/src/game/bake.test.ts`, `super-smash/src/game/bakeNode.ts`
- Modify: `super-smash/src/engine/simulate.ts` (`SimContext.bake`), `super-smash/src/game/simContext.ts` (mutable)

**Interfaces:**
- Consumes: `GAME_SIM_CONTEXT`, `engineFingerprint` (Plan 2 `src/game/simContext.ts`), `registryContext`, `SimContext` (`simulate.ts`).
- Produces (`simulate.ts`): `SimContext.bake?: BakeTables` (read by Task 12).
- Produces (`game/bake.ts`): `BAKE_URL = "/bake/roster.bin.gz"`, `FetchLike`, `fetchBake(fetchFn?): Promise<BakeTables>` (rejects "Could not load the fighters' animation data (HTTP n)." or "…does not match this version of the game. Reload the page."), `bakedContext(base, tables): SimContext`, `installBake(tables)`, `loadBake(fetchFn?)` (memoised; a failure may be retried).
- Produces (`game/bakeNode.ts`): `readBakeFromDisk(root?): BakeTables` (Node/vitest; throws naming the regeneration command when the digest differs).

- [ ] **Step 1: Write the failing test** — `src/game/bake.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BAKE_DIGEST } from "@/fighters/bake/digest";
import { fetchBake } from "./bake";

const GZ = readFileSync(join(process.cwd(), "public", "bake", "roster.bin.gz"));

const serve = (bytes: Uint8Array, status = 200) => async () => ({
  ok: status === 200,
  status,
  body: new Response(bytes as BodyInit).body,
});

describe("loading the bake in the browser", () => {
  it("verifies the committed file and decodes it into tables with its fingerprint", async () => {
    const tables = await fetchBake(serve(new Uint8Array(GZ)));
    expect(tables.fingerprint).toBe(BAKE_DIGEST);
    expect(tables.hurtboxes("mario")?.length).toBeGreaterThan(0);
  });

  it("refuses a bake from another build rather than playing with the wrong bones", async () => {
    const { gzipSync, gunzipSync } = await import("node:zlib");
    const raw = gunzipSync(GZ);
    raw[raw.length - 1] ^= 1;
    await expect(fetchBake(serve(new Uint8Array(gzipSync(raw))))).rejects.toThrow(/does not match this version/);
  });

  it("says what failed when the file is missing", async () => {
    await expect(fetchBake(serve(new Uint8Array(0), 404))).rejects.toThrow(/HTTP 404/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/game/bake.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./bake" from "src/game/bake.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — in `src/engine/simulate.ts`, add `import type { BakeTables } from "./acmd/bakeTables";` after `import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";`, and to `interface SimContext`, after Plan 2's `readonly bones?: BoneTable;`:

```ts
  /**
   * Plan 4: the bake's motion clocks and per-bone hurtboxes (`acmd/bakeTables.ts`).
   * Absent means Plan 2's single capsule and fixed ECB.
   */
  readonly bake?: BakeTables;
```

In `src/game/simContext.ts` (Plan 3's final: `EngineRules`, `GAME_ENGINE_RULES`, `engineFingerprint(ctx, rules)`) replace `export const GAME_SIM_CONTEXT: SimContext = { ...registryContext, bones: LEGACY_BONE_TABLE };` with

```ts
/** Mutable so `installBake` (Plan 4, `game/bake.ts`) can swap the bake in once it has loaded. */
export const GAME_SIM_CONTEXT: { -readonly [K in keyof SimContext]: SimContext[K] } = { ...registryContext, bones: LEGACY_BONE_TABLE };
```

(`engineFingerprint` is unchanged: it reads `bones.fingerprint`, which `bakeTables` sets to the bake's digest; Task 13 adds the limb-bone slots to the `EngineRules` it also hashes.)

`src/game/bake.ts`:

```ts
/**
 * Loading the bake in the browser (Plan 4).
 *
 * `public/bake/roster.bin.gz` is fetched once, gunzipped with the platform's
 * `DecompressionStream`, checked against the digest compiled into this build
 * (`BAKE_DIGEST`) and decoded into the tables the sim reads. A file that does
 * not match is refused: a stale cached bake would put hitboxes somewhere other
 * than where this build's renderer draws limbs, and online it would desync.
 */

import { decodeBake } from "@/engine/acmd/bakeCodec";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import { BAKE_BYTES, BAKE_DIGEST } from "@/fighters/bake/digest";
import { registryContext, type SimContext } from "@/engine/simulate";
import { GAME_SIM_CONTEXT } from "./simContext";

export const BAKE_URL = "/bake/roster.bin.gz";

export type FetchLike = (url: string) => Promise<Pick<Response, "ok" | "status" | "body">>;

async function gunzip(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const stream = body.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch, verify and decode the bake. Rejects with a sentence a player can read. */
export async function fetchBake(fetchFn: FetchLike = (u) => fetch(u, { cache: "no-cache" })): Promise<BakeTables> {
  const res = await fetchFn(BAKE_URL);
  if (!res.ok || res.body === null) throw new Error(`Could not load the fighters' animation data (HTTP ${res.status}).`);
  const bytes = await gunzip(res.body);
  if (bytes.length !== BAKE_BYTES || (await sha256Hex(bytes)) !== BAKE_DIGEST) {
    throw new Error("The fighters' animation data does not match this version of the game. Reload the page.");
  }
  return bakeTables(decodeBake(bytes), BAKE_DIGEST);
}

/**
 * The game's context over `base` with the bake in it: baked bones for hitboxes
 * and the online fingerprint, clocks and hurtboxes for the bone hurtboxes and
 * ECB. (Task 13 adds the fighters' limb-bone scripts here.)
 */
export function bakedContext(base: Pick<SimContext, "fighter" | "stage">, tables: BakeTables): SimContext {
  return {
    fighter: (id) => base.fighter(id),
    stage: (id) => base.stage(id),
    bones: tables.bones,
    bake: tables,
  };
}

/** Put the bake into Plan 2's `GAME_SIM_CONTEXT`, which every match steps with. */
export function installBake(tables: BakeTables): void {
  const ctx = bakedContext(registryContext, tables);
  GAME_SIM_CONTEXT.fighter = ctx.fighter;
  GAME_SIM_CONTEXT.bones = ctx.bones;
  GAME_SIM_CONTEXT.bake = ctx.bake;
}

let loading: Promise<BakeTables> | null = null;

/** The bake, fetched at most once per page; a failed fetch may be retried. */
export function loadBake(fetchFn?: FetchLike): Promise<BakeTables> {
  if (loading === null) {
    loading = fetchBake(fetchFn).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** Load the bake (once) and install it in `GAME_SIM_CONTEXT`; what every page awaits before a match. */
export async function ensureBakeInstalled(fetchFn?: FetchLike): Promise<BakeTables> {
  const tables = await loadBake(fetchFn);
  installBake(tables);
  return tables;
}
```

`src/game/bakeNode.ts`:

```ts
/**
 * Reading the committed bake from disk, for vitest and Node scripts (Plan 4).
 * The browser goes through `bake.ts`; both verify the same digest.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { decodeBake } from "@/engine/acmd/bakeCodec";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import { BAKE_DIGEST } from "@/fighters/bake/digest";

export function readBakeFromDisk(root = process.cwd()): BakeTables {
  const bytes = gunzipSync(readFileSync(join(root, "public", "bake", "roster.bin.gz")));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== BAKE_DIGEST) {
    throw new Error("public/bake/roster.bin.gz does not match BAKE_DIGEST — run UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts");
  }
  return bakeTables(decodeBake(new Uint8Array(bytes)), digest);
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/game/bake.test.ts`
Expected: PASS (3 tests). jsdom under Node 26 provides `DecompressionStream` and `crypto.subtle`.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/game/bake.ts super-smash/src/game/bake.test.ts super-smash/src/game/bakeNode.ts super-smash/src/engine/simulate.ts super-smash/src/game/simContext.ts
git commit -m "super-smash: load, verify and install the bake in the game's sim context" -m "The client fetches roster.bin.gz once, refuses a copy whose SHA-256 differs from this build's, and installs its bones (and fingerprint, for Plan 2's online handshake), clocks and hurtboxes in GAME_SIM_CONTEXT. registryContext keeps the root bone." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Per-bone hurtboxes, the ECB from bones, at SSBU's sizes

Ultimate's hurtboxes are capsules on bones (R§3). The replica's are the capsules Task 6 derived from mesh weights (UNVERIFIED — no public source lists them), placed every frame through the same baked table the hitboxes use: a crouch lowers the head hurtbox, a kick extends a leg into the opponent's reach. Points are mirrored by facing exactly as hitboxes are. Without a bake (or for a motion the bake lacks) both fall back to Plan 2 exactly.

**Sizes are SSBU's (D57, decided).** A fighter's body is now its model's, not the legacy box: hurtboxes, the ECB and — through Task 13's limb hitboxes — reach all come from the bones, and `attributes.width`/`height` remain only as the no-bake fallback (and in three places this plan leaves alone: the ledge-trump offset, Plan 3's shield centre — decided: no, "Decisions taken" 7 — and the blob-shadow size). The standing numbers, measured on the committed skeletons, are a generated ratchet, `src/game/hurt.allow.json`, the old box beside the bones', so any later change to a skeleton, a hurt bone or the stand clip arrives as a reviewed diff of these lines:

| fighter | legacy top / half | bones top / half |
|---|---|---|
| Mario | 11.0 / 2.0 | 13.5 / 2.3 |
| Donkey Kong | 15.0 / 3.2 | 26.3 / 4.3 |
| Link | 12.4 / 2.1 | 17.8 / 3.1 |
| Samus | 12.2 / 2.3 | 21.3 / 2.1 |
| Kirby | 6.6 / 1.9 | 9.4 / 4.3 |
| Fox | 11.0 / 2.0 | 16.3 / 2.8 |
| Pikachu | 6.9 / 1.8 | 11.3 / 3.4 |
| Marth | 13.0 / 2.0 | 18.8 / 2.4 |

The ECB completes Plan 2's seam (Task 25): its top is the highest point of this frame's capsules; its half-width is the reach of the **pelvis** capsule (`Hip`; Kirby's whole round `Body`), not a limb's — the chest was tried first on the real skeletons and gave Donkey Kong a 21.6-unit-wide standing ECB (his barrel chest has r 6.1, hunched 4.7 forward), wide enough to grab a ledge from across a platform; the pelvis gives 8.6 (UNVERIFIED). The bottom stays at the feet as Ultimate locks it on the ground (airborne too — decided, "Decisions taken" 5; UNVERIFIED). Never narrower or shorter than half the fighter's *standing* ECB (`restEcb`, cached per bake), so a tumbling body cannot shrink to a point and slip through an edge — the floor scales with the fighter instead of with the retired box. The camera frames "a fighter" as 13 units (`FIGHTER_UNITS`); `framing.test.ts` checks that every fighter's standing body still fits with at least 4 units over the head on every stage, alone and two apart at the platform's edges. Measured: at least 16.7 units of headroom, so no camera constant changes.

**Files:**
- Create: `super-smash/src/engine/acmd/hurtboxes.ts`, `super-smash/src/game/hurtboxes.test.ts`, `super-smash/src/game/hurt.allow.json` (generated), `super-smash/src/game/framing.test.ts`
- Modify: `super-smash/src/engine/simulate.ts` (`step`, `resolveHits`), `super-smash/src/engine/physics.ts` (`CollisionOptions.ecb`), `super-smash/src/engine/constants.ts` (`ENGINE_RULES_VERSION` 4), `super-smash/src/game/simContext.test.ts`, `super-smash/src/game/golden.test.ts`, `super-smash/src/game/__golden__/engine-trace.json` (regenerated)

**Interfaces:**
- Consumes: `poseIndexOf` (Task 9), `BakeTables` (Task 10), `hurtBonesFor` (Task 6), `bonePoint`, `newBonePose`, `BoneTable` (Plan 2), `Capsule`, `hurtboxCapsule` (`hitbox.ts`), `Ecb`, `ecbOf` (`physics.ts`, Plan 2 Task 25), `cameraTarget`, `VIEW_HEIGHT` (`render/camera.ts`).
- Produces: `localHurtboxes(def, f, globalFrame, bake, bones?): Capsule[] | null` (facing-relative), `fighterHurtboxes(def, f, globalFrame, bake, bones?): Capsule[] | null` (world), `ECB_BODY_BONES` (`hip`, `body`), `ecbFromHurtboxes(local, boneNames, minHalf, minTop): Ecb`, `restEcb(def, bake, bones?): Ecb | null`, `bakedEcb(def, f, globalFrame, bake, bones?): Ecb | null`; `CollisionOptions.ecb?: Ecb`; `ENGINE_RULES_VERSION = 4`.
- Command: `UPDATE_HURT=1 pnpm vitest run src/game/hurtboxes.test.ts`.

- [ ] **Step 1: Write the failing tests** — `src/game/hurtboxes.test.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_BAKE } from "@/engine/acmd/bakeTables";
import { bakedEcb, ECB_BODY_BONES, fighterHurtboxes, localHurtboxes, restEcb } from "@/engine/acmd/hurtboxes";
import { poseIndexOf } from "@/engine/acmd/poseClock";
import { fx, toFloat } from "@/engine/fixed";
import { hurtboxCapsule } from "@/engine/hitbox";
import { FIGHTERS } from "@/fighters";
import { makeFighter } from "@/render/testFixtures";
import { hurtBonesFor } from "@/render3d/skeletons/hurtBones";
import { readBakeFromDisk } from "./bakeNode";

const bake = readBakeFromDisk();
const mario = FIGHTERS.find((f) => f.id === "mario")!;
const top = (caps: readonly { y1: number; y2: number; r: number }[]) => Math.max(...caps.map((c) => Math.max(c.y1, c.y2) + c.r));

describe("per-bone hurtboxes from the bake (Plan 4)", () => {
  it("gives every fighter one capsule per baked hurt bone while standing", () => {
    for (const def of FIGHTERS) {
      const caps = localHurtboxes(def, makeFighter({ defId: def.id }), 0, bake);
      expect(caps, def.id).not.toBeNull();
      expect(caps!.length).toBe(bake.hurtboxes(def.id)!.length);
      expect(caps!.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("lowers the hurtboxes when the fighter crouches", () => {
    const stand = localHurtboxes(mario, makeFighter({ action: "stand" }), 0, bake)!;
    const crouch = localHurtboxes(mario, makeFighter({ action: "crouch", actionFrame: 10 }), 0, bake)!;
    expect(top(crouch)).toBeLessThan(top(stand) - fx(1));
  });

  it("mirrors with facing exactly as hitboxes do", () => {
    const right = fighterHurtboxes(mario, makeFighter({ x: fx(10), facing: 1, action: "walk", actionFrame: 7, vx: fx(1) }), 0, bake)!;
    const left = fighterHurtboxes(mario, makeFighter({ x: fx(10), facing: -1, action: "walk", actionFrame: 7, vx: fx(-1) }), 0, bake)!;
    right.forEach((c, i) => {
      expect(left[i].x1 - fx(10) + (c.x1 - fx(10))).toBe(0);
      expect(left[i].y1).toBe(c.y1);
      expect(left[i].r).toBe(c.r);
    });
  });

  it("has the head capsule reach the top of the body when standing (the overlay anchors there)", () => {
    for (const def of FIGHTERS) {
      const caps = localHurtboxes(def, makeFighter({ defId: def.id }), 0, bake)!;
      const head = bake.hurtboxes(def.id)!.findIndex((h) => h.bone === hurtBonesFor(def.id).head.toLowerCase());
      expect(head, def.id).toBeGreaterThanOrEqual(0);
      // Within a unit, not exactly: Samus's shoulder pads rise 0.3 over her helmet.
      expect(top(caps) - (Math.max(caps[head].y1, caps[head].y2) + caps[head].r), def.id).toBeLessThan(fx(1));
    }
  });

  it("returns null without a bake, so the sim keeps Plan 2's single capsule", () => {
    expect(fighterHurtboxes(mario, makeFighter(), 0, LEGACY_BAKE)).toBeNull();
    expect(bakedEcb(mario, makeFighter(), 0, LEGACY_BAKE)).toBeNull();
  });

  it("indexes an attack by its script's motion frame, a status by its clock", () => {
    expect(poseIndexOf(mario, makeFighter({ action: "attack", move: "jab1", actionFrame: 2 }), 0, bake.clock)).toEqual({
      motion: "attack_11",
      frame: 3,
    });
    expect(poseIndexOf(mario, makeFighter({ action: "crouch", actionFrame: 5 }), 0, bake.clock)?.motion).toBe("status_crouch");
  });
});

describe("the ECB from bones (Plan 4)", () => {
  it("keeps its bottom at the feet and its top over the head", () => {
    const e = bakedEcb(mario, makeFighter(), 0, bake)!;
    expect(e.bottom).toBe(0);
    expect(e.top).toBe(top(localHurtboxes(mario, makeFighter(), 0, bake)!));
  });

  it("shrinks with a crouch but never below half its standing ECB", () => {
    const stand = bakedEcb(mario, makeFighter(), 0, bake)!;
    const crouch = bakedEcb(mario, makeFighter({ action: "crouch", actionFrame: 10 }), 0, bake)!;
    expect(stand).toEqual(restEcb(mario, bake));
    expect(crouch.top).toBeLessThan(stand.top);
    expect(crouch.top).toBeGreaterThanOrEqual(stand.top >> 1);
    expect(crouch.half).toBeGreaterThanOrEqual(stand.half >> 1);
  });

  it("is as wide as the pelvis capsule (Kirby's Body), not the chest or a limb", () => {
    for (const def of FIGHTERS) {
      const rest = restEcb(def, bake)!;
      const caps = localHurtboxes(def, makeFighter({ defId: def.id }), 0, bake)!;
      const body = bake.hurtboxes(def.id)!.map((h, i) => (ECB_BODY_BONES.has(h.bone) ? i : -1)).filter((i) => i >= 0);
      expect(body.length, def.id).toBe(1);
      expect(rest.half, def.id).toBe(Math.max(...body.map((i) => Math.max(Math.abs(caps[i].x1), Math.abs(caps[i].x2)) + caps[i].r)));
    }
  });
});

/**
 * SSBU sizes replace the legacy boxes (D57): every fighter's standing body is
 * its model's. This ratchet lists both, so any change to a skeleton, a hurt
 * bone or the stand clip shows up as a reviewed diff of these numbers:
 *
 *   UPDATE_HURT=1 pnpm vitest run src/game/hurtboxes.test.ts
 */
describe("body sizes: legacy box beside the bones (Plan 4, hurt.allow.json)", () => {
  const FILE = join(process.cwd(), "src", "game", "hurt.allow.json");
  const now: Record<string, string> = {};
  for (const def of FIGHTERS) {
    const legacy = hurtboxCapsule(makeFighter({ defId: def.id }), def.attributes);
    const rest = restEcb(def, bake)!;
    const n = (v: number) => toFloat(v).toFixed(1);
    now[def.id] = `legacy top ${n(legacy.y2 + legacy.r)} half ${n(def.attributes.width)} / bones top ${n(rest.top)} half ${n(rest.half)}`;
  }
  if (process.env.UPDATE_HURT === "1") {
    it("writes hurt.allow.json", () => {
      writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
    });
    return;
  }
  it("are exactly the reviewed numbers", () => {
    expect(now).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  });
});
```

`src/game/framing.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { restEcb } from "@/engine/acmd/hurtboxes";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { cameraTarget, VIEW_HEIGHT } from "@/render/camera";
import { makeFighter, makeState } from "@/render/testFixtures";
import { STAGES } from "@/stages";
import { readBakeFromDisk } from "./bakeNode";

const bake = readBakeFromDisk();

/**
 * SSBU sizes (D57) make DK 26 units tall where the camera frames "a fighter"
 * as 13 (`FIGHTER_UNITS`). The frame must still hold every fighter's whole
 * standing body with room over the head — on every stage, alone in the
 * middle or two apart at the main platform's edges, where the camera is
 * zoomed in furthest and widest respectively. Measured when written: at
 * least 16.7 units of headroom everywhere, so no camera constant changed.
 */
const HEADROOM = 4;

describe("the camera frames SSBU-sized fighters (Plan 4)", () => {
  for (const stage of STAGES) {
    it(`${stage.id}: every fighter's standing body is in frame with ${HEADROOM} units over the head`, () => {
      const main = stage.platforms.find((p) => p.ledges) ?? stage.platforms[0];
      let worst = Infinity;
      for (const def of FIGHTERS) {
        const top = toFloat(restEcb(def, bake)!.top);
        for (const xs of [[0], [-0.9, 0.9]]) {
          const fighters = xs.map((k, port) => makeFighter({ port, defId: def.id, x: main.x + Math.round(toFloat(main.halfWidth) * k) * fx(1), y: main.y }));
          const cam = cameraTarget(makeState({ fighters, stageId: stage.id }), stage);
          const viewTop = cam.y + VIEW_HEIGHT / (2 * cam.zoom);
          for (const f of fighters) worst = Math.min(worst, viewTop - (toFloat(f.y) + top));
        }
      }
      expect(worst).toBeGreaterThanOrEqual(HEADROOM);
    });
  }
});
```

`src/game/simContext.test.ts` — replace Plan 3's last test, `it("is Plan 3's rules version", () => { expect(ENGINE_RULES_VERSION).toBe(3); });`, with

```ts
  it("is Plan 4's rules version (bone hurtboxes and ECB change what step() does)", () => {
    expect(ENGINE_RULES_VERSION).toBe(4);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/game/hurtboxes.test.ts src/game/framing.test.ts src/game/simContext.test.ts`
Expected: FAIL — `Error: Failed to resolve import "@/engine/acmd/hurtboxes" from "src/game/hurtboxes.test.ts". Does the file exist?` (and the same from `framing.test.ts`); `simContext.test.ts`: `AssertionError: expected 3 to be 4 // Object.is equality`.

- [ ] **Step 3: Implement** — `src/engine/acmd/hurtboxes.ts`:

```ts
/**
 * Per-bone hurtboxes and the bone-derived ECB (Plan 4).
 *
 * Ultimate's hurtboxes are capsules on bones (research R§3, "Hurtboxes"). The
 * replica's are the capsules the bake derived from each fighter's mesh weights
 * (UNVERIFIED: no public source lists them), placed every frame through the
 * same baked bone table the hitboxes use — so a crouch lowers the head
 * hurtbox, a kick extends a leg into the opponent's reach, and what you see is
 * what can be hit.
 *
 * Facing-relative bone points are mirrored by facing exactly as hitboxes are
 * (`hitboxWorldPos`). When the fighter's motion has no bake, the caller keeps
 * Plan 2's single capsule.
 *
 * Sizes are SSBU's (D57): with a bake, a fighter's body is its model's — DK's
 * standing hurtboxes reach 31.6 units, Kirby's 9.8 — and `attributes.width` /
 * `height` are only the no-bake fallback. `src/game/hurt.allow.json` records,
 * per fighter, the old box beside the bones' numbers.
 */

import { bonePoint, newBonePose, type BoneTable } from "./bones";
import type { Ecb } from "../physics";
import type { Capsule } from "../hitbox";
import type { FighterDef } from "../types";
import type { BakeTables } from "./bakeTables";
import { poseIndexOf, type ClockedFighter } from "./poseClock";

type Placed = ClockedFighter & { readonly x: number; readonly y: number; readonly facing: number };

/** Facing-relative capsules (origin at the feet, +x forward), or null without a bake. */
export function localHurtboxes(def: FighterDef, f: ClockedFighter, globalFrame: number, bake: BakeTables, bones: BoneTable = bake.bones): Capsule[] | null {
  const boxes = bake.hurtboxes(def.id);
  if (boxes === undefined || boxes.length === 0) return null;
  const at = poseIndexOf(def, f, globalFrame, bake.clock);
  if (at === null) return null;
  const out: Capsule[] = [];
  const pose = newBonePose();
  for (const h of boxes) {
    if (!bones.pose(def.id, at.motion, at.frame, h.bone, pose)) return null;
    const a = bonePoint(pose, h.x1, 0, 0);
    const b = bonePoint(pose, h.x2, 0, 0);
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: h.r });
  }
  return out;
}

/** World-space hurtbox capsules for this frame, or null without a bake. */
export function fighterHurtboxes(def: FighterDef, f: Placed, globalFrame: number, bake: BakeTables, bones: BoneTable = bake.bones): Capsule[] | null {
  const local = localHurtboxes(def, f, globalFrame, bake, bones);
  if (local === null) return null;
  const s = f.facing >= 0 ? 1 : -1;
  return local.map((c) => ({ x1: f.x + s * c.x1, y1: f.y + c.y1, x2: f.x + s * c.x2, y2: f.y + c.y2, r: c.r }));
}

/**
 * Bones whose capsules set the ECB's half-width: the pelvis (Kirby's whole
 * round `Body`), not the chest or a flailing limb. The chest was tried first on
 * the real skeletons: DK's barrel chest (r 6.1, hunched 4.7 forward) made his
 * standing ECB 21.6 units wide against a legacy 6.4, enough to grab a ledge
 * from a stage-width away; the pelvis gives 8.6 (UNVERIFIED, D57).
 */
export const ECB_BODY_BONES: ReadonlySet<string> = new Set(["hip", "body"]);

/**
 * The ECB from this frame's hurt capsules: the top is the highest point of any
 * capsule; the half-width is the widest reach of the body capsules either side
 * of the origin; the bottom stays at the feet, as Ultimate locks it on the
 * ground (UNVERIFIED in the air — kept at the feet there too, D57).
 *
 * Never narrower than `minHalf` or shorter than `minTop` (half the fighter's
 * standing ECB, `restEcb`), so a tumbling or crouching body cannot shrink the
 * ECB to a point and slip through a platform edge.
 */
export function ecbFromHurtboxes(
  local: readonly Capsule[],
  bones: readonly string[],
  minHalf: number,
  minTop: number,
): Ecb {
  let top = minTop;
  let half = minHalf;
  local.forEach((c, i) => {
    top = Math.max(top, c.y1 + c.r, c.y2 + c.r);
    if (ECB_BODY_BONES.has(bones[i])) half = Math.max(half, Math.abs(c.x1) + c.r, Math.abs(c.x2) + c.r);
  });
  return { bottom: 0, top, half };
}

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
  shortHop: false,
};
const restCache = new WeakMap<BakeTables, WeakMap<BoneTable, Map<string, Ecb | null>>>();

/** The fighter's ECB standing still on frame 0 — the size of its body (D57) — or null without a bake. */
export function restEcb(def: FighterDef, bake: BakeTables, bones: BoneTable = bake.bones): Ecb | null {
  let byBones = restCache.get(bake);
  if (byBones === undefined) restCache.set(bake, (byBones = new WeakMap()));
  let byFighter = byBones.get(bones);
  if (byFighter === undefined) byBones.set(bones, (byFighter = new Map()));
  if (!byFighter.has(def.id)) {
    const local = localHurtboxes(def, { ...STANDING, defId: def.id }, 0, bake, bones);
    const names = (bake.hurtboxes(def.id) ?? []).map((h) => h.bone.toLowerCase());
    byFighter.set(def.id, local === null ? null : ecbFromHurtboxes(local, names, 0, 0));
  }
  return byFighter.get(def.id)!;
}

/** The ECB for a fighter this frame, or null without a bake. */
export function bakedEcb(def: FighterDef, f: ClockedFighter, globalFrame: number, bake: BakeTables, bones: BoneTable = bake.bones): Ecb | null {
  const rest = restEcb(def, bake, bones);
  if (rest === null) return null;
  const local = localHurtboxes(def, f, globalFrame, bake, bones);
  if (local === null) return null;
  const names = (bake.hurtboxes(def.id) ?? []).map((h) => h.bone.toLowerCase());
  return ecbFromHurtboxes(local, names, rest.half >> 1, rest.top >> 1);
}
```

`src/engine/physics.ts` — in `interface CollisionOptions`, after `passThroughSoft`:

```ts
  /** This frame's ECB from the bake (Plan 4); `ecbOf` when absent. */
  readonly ecb?: Ecb;
```

and in `resolveCollision` replace `const ecb = ecbOf(f, attrs);` with `const ecb = opts.ecb ?? ecbOf(f, attrs);` (if Plan 2's final `ecbOf` takes more arguments, keep them — only the `opts.ecb ??` prefix is new).

`src/engine/simulate.ts`:
1. Imports: change Task 11's `import type { BakeTables } from "./acmd/bakeTables";` to `import { LEGACY_BAKE, type BakeTables } from "./acmd/bakeTables";` and add `import { bakedEcb, fighterHurtboxes } from "./acmd/hurtboxes";` after it.
2. In `step`, after `const defs = s.fighters.map((f) => ctx.fighter(f.defId));`:

```ts
  const bones = ctx.bones ?? LEGACY_BONE_TABLE;
  const bake = ctx.bake ?? LEGACY_BAKE;
```

and change `gatherHitboxes(s, defs, prevPos, frozen, ctx.bones ?? LEGACY_BONE_TABLE)` to `gatherHitboxes(s, defs, prevPos, frozen, bones)`.
3. In phase 5 (platforms and ledges), between `const before = launchBefore(f);` and `const outcome = resolveCollision(`:

```ts
    // The ECB from this frame's bones (Plan 4), or Plan 2's box without a bake.
    const ecb = bakedEcb(defs[i], f, s.frame, bake, bones) ?? ecbOf(f, defs[i].attributes);
```

add `{ ecb },` as `resolveCollision`'s last argument (after `s.frame,`), and in the ledge grab change `findLedgeGrab(f, stage, s.frame, ecbOf(f, defs[i].attributes).half)` to `findLedgeGrab(f, stage, s.frame, ecb.half)`.
4. `resolveHits`: add the parameters `bake: BakeTables, bones: BoneTable,` after `defs: readonly FighterDef[],`, call it as `resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed);`, replace

```ts
    const hurtbox = hurtboxCapsule(victim, defs[v].attributes);
```

with

```ts
    // One capsule per bone from the bake (Plan 4), else Plan 2's single capsule.
    const hurtboxes = fighterHurtboxes(defs[v], victim, s.frame, bake, bones) ?? [hurtboxCapsule(victim, defs[v].attributes)];
```

and Plan 3's glancing-blow depth

```ts
      const depth = sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, hurtbox);
```

with the deepest any capsule is reached:

```ts
      // The deepest any hurt capsule is reached (Plan 4: one per bone).
      let depth = -Infinity;
      for (const h of hurtboxes) depth = Math.max(depth, sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, h));
```

(`GLANCING_BLOW_DEPTH` then applies to that deepest reach, as Plan 3's rule does to the single capsule.)

`src/engine/constants.ts` — Plan 3 asked every later plan that changes what `step()` does to bump the rules version, and per-bone hurtboxes and the bone ECB do: change `export const ENGINE_RULES_VERSION = 3;` to `export const ENGINE_RULES_VERSION = 4;` and add to its doc comment the line ` * Plan 4: 4 — per-bone hurtboxes and the bone-derived ECB.` after "every later plan that changes what `step()` does bumps it.".

`src/game/golden.test.ts` — the trace now plays the game's world. Rename its `const CTX: SimContext = { fighter(id) {…}, stage(id) {…} };` to `const BASE: SimContext = { … };` and add after it:

```ts
// As the game plays (Plan 4): the committed bake — limb-bone hitboxes, per-bone
// hurtboxes, the bone-derived ECB — and the limb-bone scripts it can place (Task 13).
const CTX: SimContext = bakedContext(BASE, readBakeFromDisk());
```

with `import { bakedContext } from "./bake";` and `import { readBakeFromDisk } from "./bakeNode";` after the `@/stages` import.

- [ ] **Step 4: Run them again, then write the size ratchet**

Run: `pnpm vitest run src/game/hurtboxes.test.ts src/game/framing.test.ts src/game/simContext.test.ts`
Expected: everything passes except "are exactly the reviewed numbers": `Error: ENOENT: no such file or directory, open '…/src/game/hurt.allow.json'` (9 of 10 in `hurtboxes.test.ts`; `framing.test.ts` 6, `simContext.test.ts` 5).

Run: `UPDATE_HURT=1 pnpm vitest run src/game/hurtboxes.test.ts && cat src/game/hurt.allow.json`
Expected: exactly

```json
{
  "mario": "legacy top 11.0 half 2.0 / bones top 13.5 half 2.3",
  "donkeyKong": "legacy top 15.0 half 3.2 / bones top 26.3 half 4.3",
  "link": "legacy top 12.4 half 2.1 / bones top 17.8 half 3.1",
  "samus": "legacy top 12.2 half 2.3 / bones top 21.3 half 2.1",
  "kirby": "legacy top 6.6 half 1.9 / bones top 9.4 half 4.3",
  "fox": "legacy top 11.0 half 2.0 / bones top 16.3 half 2.8",
  "pikachu": "legacy top 6.9 half 1.8 / bones top 11.3 half 3.4",
  "marth": "legacy top 13.0 half 2.0 / bones top 18.8 half 2.4"
}
```

(the table above). Read it before going on: each line is a fighter whose body changes size in the game. If a fighter's "bones top" is far from what its model looks like in `/anim` once Task 21 exists, the capsule picked up a prop — add the prop's bone name pattern to `NOT_BODY` in `skeleton_from_blend.py` (and `export_gltf.py`), re-run Task 6 Steps 5–6 and re-bake.

Run: `pnpm vitest run src/game/hurtboxes.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Regenerate the golden trace (behaviour change), then the gate**

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm typecheck && pnpm lint && pnpm test`
Expected: the trace is rewritten — all four matches diverge, because hits, walls and ledges now meet SSBU-sized bodies; the gate exits 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/engine/acmd/hurtboxes.ts super-smash/src/game/hurtboxes.test.ts super-smash/src/game/hurt.allow.json super-smash/src/game/framing.test.ts super-smash/src/engine/simulate.ts super-smash/src/engine/physics.ts super-smash/src/engine/constants.ts super-smash/src/game/simContext.test.ts super-smash/src/game/golden.test.ts super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: hurtboxes and the ECB from bones, at SSBU's sizes" -m "A hit now needs to reach one of the fighter's per-bone capsules (from mesh weights, UNVERIFIED), placed every frame from the bake; the ECB's top follows this frame's capsules and its width the pelvis, with the bottom locked at the feet. Bodies are the models' (D57): hurt.allow.json lists each fighter's legacy box beside its bones' numbers (DK 15.0 to 26.3 tall), and the camera still frames them with 16.7 units to spare. ENGINE_RULES_VERSION 4. Golden trace regenerated: hits, walls and ledges meet the new bodies." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Switch on the published limb-bone `game_` scripts

Plan 3 (Task 17, `src/fighters/acmd/active.ts`) switched on the scripts whose boxes hang off the root bone and stopped at the boundary its test names: "a script that hangs a box off a limb bone needs the bone bake to place it". This task crosses it by widening `activatable`'s one bone check — from "every bone is `top`" to "every bone is `top` or in the fighter's committed skeleton" — and keeping every other rule of Plan 3's (no throws or pummels, no momentum, projectile, armour or smash charge, only interpreted or cosmetic commands, boxes cleared by the script). Plan 3's capsule hitboxes (its Task 19) already place both ends of an extended box through the bone. The list is generated into `src/fighters/acmd/limb.json` and reviewed in the diff; the scripts run **only in the game's context** (`bakedContext`), beside the bake that places them — the plain roster and `registryContext` keep Plan 3's root-bone set, so Plan 3's `active.test.ts` ("activates no script with a box on any bone but the root", which checks the roster) stays true and no unit test that steps without the bake meets a bone it cannot place. On the eight committed skeletons the census switches on **53 slots**: Mario `bair dtilt fair ftilt jab2 jab3 nair uair utilt`; Donkey Kong `bair fair jab1 jab2 nair`; Link `bair ftilt jab3 nair utilt` (sword moves); Samus `bair dair dashGrab dtilt fair ftilt grab jab2 nair utilt`; Kirby `dtilt ftilt nair uair`; Fox `bair dair ftilt nair uair` (tail); Pikachu `bair dair dashAttack ftilt uair utilt`; Marth `dair dtilt fair ftilt jab1 jab2 nair uair utilt` (blade, with the published tipper) — subject to Plan 3's other rules (smashes are chargeable and stay legacy).

Two things follow from running them, and this task does both. **The bake must bake the fighters the game plays.** Task 10 baked `FIGHTERS` as they stood; a switched-on slot now plays its imported script's motion for that script's length (Mario's `uair`: 32 motion frames, not the legacy 30; Kirby's `nair` 56, not 52), so `bakeRoster` bakes `withLimbScripts(def)`, and the hurtboxes, the drawn limbs and the hitboxes stay on one clock. **The online fingerprint must cover the list.** Plan 3's `engineFingerprint` hashes the bones, `ENGINE_RULES_VERSION` and `EngineRules.activeSlots`; two builds with the same bake but a different `limb.json` run different scripts, so `installBake` adds `LIMB_SCRIPT_SLOTS` to `GAME_ENGINE_RULES.activeSlots` (`mergeSlots`), and the peers' fingerprints differ.

A limb hitbox now goes where *our clip* puts the limb, not where Ultimate's animation would. `reach.test.ts` is the ratchet for that: every switched-on move's furthest forward hitbox edge against the same move's legacy reach (transcribed from the same published data, D17); a difference over 3 units or 30% is listed in `reach.allow.json` with both numbers, and a new one fails until a human fixes the clip or allows it. With SSBU-sized limbs (D57) 27 moves are listed; the largest are Donkey Kong's (`fair` 14.0 → 26.5, `nair` 11.0 → 25.6) — the size of his model, which D57 adopts.

**Files:**
- Create: `super-smash/src/fighters/acmd/limb.ts`, `super-smash/src/fighters/acmd/limb.test.ts`, `super-smash/src/fighters/acmd/limb.json` (generated), `super-smash/src/fighters/acmd/reach.test.ts`, `super-smash/src/fighters/acmd/reach.allow.json` (generated)
- Modify: `super-smash/src/fighters/acmd/active.ts` (`activatable` takes `placeable`), `super-smash/src/fighters/acmd/reconcile.test.ts`, `super-smash/src/fighters/acmd/reconcile.allow.json` (regenerated), `super-smash/src/render3d/bake/roster.ts` (bakes `withLimbScripts(def)`), `super-smash/src/render3d/bake/roster.test.ts` (one test), `super-smash/src/game/bake.ts` (`bakedContext` runs the limb scripts; `installBake` records them in the rules), `super-smash/src/game/bake.test.ts` (one test), `super-smash/src/game/simContext.ts` (`GAME_ENGINE_RULES` mutable, `mergeSlots`), `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/bake/digest.ts` (re-baked), `super-smash/src/game/golden.test.ts` (comment), `super-smash/src/game/__golden__/engine-trace.json` (regenerated)

**Interfaces:**
- Produces (`active.ts`): `ROOT_BONE_ONLY(bone)`; `activatable(slot, move, script, placeable = ROOT_BONE_ONLY)`.
- Produces (`limb.ts`): `LIMB_SCRIPT_SLOTS: Record<fighterId, MoveSlot[]>` (from `limb.json`), `withLimbScripts(def): FighterDef` (Plan 3's `withReferenceScripts` with those slots — script plus published FAF — memoised per def); `bakedContext`'s `fighter(id)` returns `withLimbScripts(base.fighter(id))`.
- Produces (`game/simContext.ts`): `GAME_ENGINE_RULES` mutable (`{ -readonly [K in keyof EngineRules]: EngineRules[K] }`), `mergeSlots(a, b): Record<string, readonly MoveSlot[]>`; after `installBake`, `GAME_ENGINE_RULES.activeSlots = mergeSlots(ACTIVE_SCRIPT_SLOTS, LIMB_SCRIPT_SLOTS)`.
- Commands: `UPDATE_LIMB=1 pnpm vitest run src/fighters/acmd/limb.test.ts`, `UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts`.

- [ ] **Step 1: Write the failing tests** — `src/fighters/acmd/limb.test.ts`:

```ts
// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import type { MoveSlot } from "@/engine/types";
import { FIGHTERS } from "../index";
import { ACTIVE_SCRIPT_SLOTS, activatable } from "./active";
import { REFERENCE_SCRIPTS } from "./index";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";

/**
 * Which limb-bone scripts the game runs (Plan 4, Task 13). Regenerate after a
 * skeleton, script or move change with
 *
 *   UPDATE_LIMB=1 pnpm vitest run src/fighters/acmd/limb.test.ts
 *
 * and name the slots that moved, and why, in the commit.
 */

const FILE = join(process.cwd(), "src", "fighters", "acmd", "limb.json");

function skeletonBones(id: string): Set<string> {
  const s = JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", `${id}.json`), "utf8")) as { bones: { name: string }[] };
  return new Set(s.bones.map((b) => b.name.toLowerCase()));
}

/** The rule's output: slots `activatable` admits once the bake places every skeleton bone, minus Plan 3's. */
function census(): { slots: Record<string, MoveSlot[]>; blocked: string[] } {
  const slots: Record<string, MoveSlot[]> = {};
  const blocked: string[] = [];
  for (const def of FIGHTERS) {
    const ref = REFERENCE_SCRIPTS[def.id];
    const have = skeletonBones(def.id);
    const placeable = (bone: string) => bone === "top" || have.has(bone);
    slots[def.id] = [];
    for (const [slot, key] of Object.entries(ref.slots) as [MoveSlot, string][]) {
      if (ACTIVE_SCRIPT_SLOTS[def.id]?.includes(slot)) continue;
      const script = ref.scripts[key];
      const limbs = [...scriptBoneNames(script.commands)];
      if (limbs.length === 0) continue;
      if (activatable(slot, def.moves[slot], script, placeable)) slots[def.id].push(slot);
      else blocked.push(`${def.id} ${slot} (${limbs.join("/")})`);
    }
    slots[def.id].sort();
  }
  return { slots, blocked };
}

describe("running the limb-bone scripts (Plan 4)", () => {
  const now = census();

  if (process.env.UPDATE_LIMB === "1") {
    it("writes limb.json", () => {
      writeFileSync(FILE, JSON.stringify(now.slots, null, 2) + "\n");
      console.log(`limb-bone scripts left on legacy moves (Plan 3's rules):\n${now.blocked.join("\n")}`);
    });
    return;
  }

  it("lists exactly the slots the widened rule admits", () => {
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(now.slots);
  });

  it("switches some on (not vacuous, D47)", () => {
    expect(Object.values(LIMB_SCRIPT_SLOTS).flat().length).toBeGreaterThan(0);
  });

  it("hands the game the imported script for a listed slot and leaves the rest as Plan 3 had them", () => {
    for (const def of FIGHTERS) {
      const game = withLimbScripts(def);
      const ref = REFERENCE_SCRIPTS[def.id];
      for (const slot of LIMB_SCRIPT_SLOTS[def.id] ?? []) expect(game.scripts?.[slot]).toBe(ref.scripts[ref.slots[slot]!]);
      for (const slot of ACTIVE_SCRIPT_SLOTS[def.id] ?? []) expect(game.scripts?.[slot]).toBe(def.scripts?.[slot]);
      expect(withLimbScripts(def)).toBe(game);
    }
  });
});
```

`src/fighters/acmd/reach.test.ts`:

```ts
// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE, type BoneTable } from "@/engine/acmd/bones";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { fx, toFloat } from "@/engine/fixed";
import type { FighterDef, MoveSlot } from "@/engine/types";
import { readBakeFromDisk } from "@/game/bakeNode";
import { FIGHTERS } from "../index";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";

/**
 * A limb-bone hitbox goes where our clip puts the limb, not where Ultimate's
 * animation would (Plan 4 risk 1). This ratchet catches a clip that puts an
 * adopted move's reach somewhere a player would call wrong: the furthest
 * forward edge of any live hitbox, baked, against the same move's legacy reach
 * (transcribed from the same published data, D17). A move off by more than
 * 3 units or 30% is listed in `reach.allow.json` with both numbers; a new one
 * fails until a human looks at it, fixes the clip, or allows it:
 *
 *   UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts
 */

const FILE = join(process.cwd(), "src", "fighters", "acmd", "reach.allow.json");
const bake = readBakeFromDisk();

function reach(def: FighterDef, slot: MoveSlot, bones: BoneTable): number {
  const script = gameScriptFor(def, slot);
  const move = def.moves[slot];
  if (script === null || move === undefined) return 0;
  let best = -Infinity;
  for (let g = 1; g <= move.totalFrames; g++) {
    const st = runScript(script, g);
    if (st.attacks.length === 0) continue;
    for (const h of scriptHitboxes(st, def.id, script.motion, g, bones)) best = Math.max(best, h.x + h.radius);
  }
  return best === -Infinity ? 0 : best;
}

function offenders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const legacy of FIGHTERS) {
    const game = withLimbScripts(legacy);
    for (const slot of LIMB_SCRIPT_SLOTS[legacy.id] ?? []) {
      const before = reach(legacy, slot, LEGACY_BONE_TABLE);
      const after = reach(game, slot, bake.bones);
      if (Math.abs(after - before) > Math.max(fx(3), Math.abs(before) * 0.3)) {
        out[`${legacy.id} ${slot}`] = `legacy ${toFloat(before).toFixed(1)} / baked ${toFloat(after).toFixed(1)}`;
      }
    }
  }
  return out;
}

describe("adopted moves reach about as far as they did (Plan 4)", () => {
  const now = offenders();
  if (process.env.UPDATE_REACH === "1") {
    it("writes reach.allow.json", () => {
      writeFileSync(FILE, JSON.stringify(now, null, 2) + "\n");
    });
    return;
  }
  it("differ only where the allowlist says, and by how much", () => {
    expect(now).toEqual(JSON.parse(readFileSync(FILE, "utf8")));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/fighters/acmd/limb.test.ts src/fighters/acmd/reach.test.ts`
Expected: FAIL (node-environment tests, so Node's resolver words it) — `Error: Cannot find module './limb' imported from …/src/fighters/acmd/limb.test.ts`, and the same from `reach.test.ts`.

- [ ] **Step 3: Implement** — `src/fighters/acmd/active.ts`: replace the line `/** The rule above, for one slot. */` and the signature under it with

```ts
/** Plan 3's bones: the root alone, the only bone `LEGACY_BONE_TABLE` places. */
export const ROOT_BONE_ONLY = (bone: string): boolean => bone === "top";

/**
 * The rule above, for one slot. `placeable` says which bones a bone table can
 * place: the root bone for Plan 3; the root and every baked limb for Plan 4's
 * `LIMB_SCRIPT_SLOTS` (`limb.ts`).
 */
export function activatable(
  slot: MoveSlot,
  move: MoveDef | undefined,
  script: AcmdScript,
  placeable: (bone: string) => boolean = ROOT_BONE_ONLY,
): boolean {
```

and in its body change `if (bones.size === 0 || ![...bones].every((b) => b === "top")) return false;` to `if (bones.size === 0 || ![...bones].every(placeable)) return false;`. `ACTIVE_SCRIPT_SLOTS` and `active.test.ts` are unchanged (the default keeps Plan 3's rule).

`src/fighters/acmd/limb.ts`:

```ts
/**
 * The published `game_` scripts whose hitboxes hang off limbs, switched on
 * (Plan 4, Task 13) — only in the game's own context, beside the bake that can
 * place those limbs (`game/bake.ts` `bakedContext`). The plain roster and
 * `registryContext` keep Plan 3's root-bone set, so a test that steps without
 * the bake never meets a bone it cannot place.
 *
 * The rule is Plan 3's `activatable` with the bones widened to the root plus
 * every bone in the fighter's committed skeleton (`src/render3d/skeletons/`);
 * `limb.json` is its output written out, regenerated and pinned by
 * `limb.test.ts`, so a reviewer sees exactly which moves changed.
 */

import type { FighterDef, MoveSlot } from "@/engine/types";
import { withReferenceScripts } from "./active";
import { REFERENCE_SCRIPTS } from "./index";
import LIMB from "./limb.json";

/** Per fighter, the slots running their imported limb-bone script in the game. */
export const LIMB_SCRIPT_SLOTS = LIMB as Readonly<Record<string, readonly MoveSlot[]>>;

const cache = new WeakMap<FighterDef, FighterDef>();

/** `def` with its limb-bone slots running their imported scripts. Same object for the same def. */
export function withLimbScripts(def: FighterDef): FighterDef {
  let out = cache.get(def);
  if (out === undefined) {
    const slots = LIMB_SCRIPT_SLOTS[def.id] ?? [];
    out = slots.length === 0 ? def : withReferenceScripts(def, REFERENCE_SCRIPTS[def.id], slots);
    cache.set(def, out);
  }
  return out;
}
```

`src/fighters/acmd/limb.json` and `src/fighters/acmd/reach.allow.json`: `{}` (generated in Steps 4 and 5).

`src/fighters/acmd/reconcile.test.ts` — a switched-on slot runs its reference script, so Plan 3's `runningFacts` already finds no disagreement once the loop walks the game's fighters. In `disagreements()` change `for (const def of FIGHTERS) {` to

```ts
  // The game's fighters: Plan 3's root-bone scripts and Plan 4's limb-bone ones.
  for (const def of FIGHTERS.map(withLimbScripts)) {
```

with `import { withLimbScripts } from "./limb";`.

- [ ] **Step 4: Generate the list, then pin the two consequences with failing tests**

Run: `UPDATE_LIMB=1 pnpm vitest run src/fighters/acmd/limb.test.ts && pnpm vitest run src/fighters/acmd/limb.test.ts`
Expected: PASS (3 tests); `src/fighters/acmd/limb.json` is exactly

```json
{
  "mario": [
    "bair",
    "dtilt",
    "fair",
    "ftilt",
    "jab2",
    "jab3",
    "nair",
    "uair",
    "utilt"
  ],
  "donkeyKong": [
    "bair",
    "fair",
    "jab1",
    "jab2",
    "nair"
  ],
  "link": [
    "bair",
    "ftilt",
    "jab3",
    "nair",
    "utilt"
  ],
  "samus": [
    "bair",
    "dair",
    "dashGrab",
    "dtilt",
    "fair",
    "ftilt",
    "grab",
    "jab2",
    "nair",
    "utilt"
  ],
  "kirby": [
    "dtilt",
    "ftilt",
    "nair",
    "uair"
  ],
  "fox": [
    "bair",
    "dair",
    "ftilt",
    "nair",
    "uair"
  ],
  "pikachu": [
    "bair",
    "dair",
    "dashAttack",
    "ftilt",
    "uair",
    "utilt"
  ],
  "marth": [
    "dair",
    "dtilt",
    "fair",
    "ftilt",
    "jab1",
    "jab2",
    "nair",
    "uair",
    "utilt"
  ]
}
```

Add to `src/render3d/bake/roster.test.ts`, before `it("round-trips through the decoder bit for bit"`, the test

```ts
  it("bakes the fighters the game plays — limb-bone scripts on — so every move's clock is its game script's length", () => {
    const baked = new Map(decodeBake(fresh).map((f) => [f.bones.fighter, f]));
    let adopted = 0;
    for (const legacy of FIGHTERS) {
      const def = withLimbScripts(legacy);
      for (const slot of LIMB_SCRIPT_SLOTS[def.id] ?? []) {
        const script = gameScriptFor(def, slot)!;
        const clock = baked.get(def.id)!.clocks[script.motion];
        expect(clock, `${def.id} ${slot} ${script.motion}`).toBeDefined();
        let last = 0;
        for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) last = Math.max(last, runScript(script, g).motionFrame);
        expect(clock.frames, `${def.id} ${slot}`).toBe(last);
        adopted++;
      }
    }
    expect(adopted).toBeGreaterThan(40);
  });
```

with these imports after `import { decodeBake, encodeBake } from "@/engine/acmd/bakeCodec";`:

```ts
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { FIGHTERS } from "@/fighters";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "@/fighters/acmd/limb";
```

Append to `src/game/bake.test.ts`:

```ts
describe("installing the bake", () => {
  it("switches the limb-bone scripts on, and the engine fingerprint says which ones run", async () => {
    const before = engineFingerprint();
    installBake(await fetchBake(serve(new Uint8Array(GZ))));
    const after = engineFingerprint();
    expect(after).not.toBe(before);
    for (const id of Object.keys(LIMB_SCRIPT_SLOTS)) {
      expect(GAME_ENGINE_RULES.activeSlots[id], id).toEqual(expect.arrayContaining([...(ACTIVE_SCRIPT_SLOTS[id] ?? []), ...LIMB_SCRIPT_SLOTS[id]]));
    }
    // Same bones, one limb move fewer: a different game, so a different fingerprint.
    const mario = GAME_ENGINE_RULES.activeSlots.mario.filter((s) => s !== LIMB_SCRIPT_SLOTS.mario[0]);
    expect(engineFingerprint(GAME_SIM_CONTEXT, { ...GAME_ENGINE_RULES, activeSlots: { ...GAME_ENGINE_RULES.activeSlots, mario } })).not.toBe(after);
  });
});
```

and replace its two imports `import { BAKE_DIGEST } from "@/fighters/bake/digest";` / `import { fetchBake } from "./bake";` with

```ts
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { LIMB_SCRIPT_SLOTS } from "@/fighters/acmd/limb";
import { BAKE_DIGEST } from "@/fighters/bake/digest";
import { fetchBake, installBake } from "./bake";
import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, engineFingerprint } from "./simContext";
```

Run: `pnpm vitest run src/render3d/bake/roster.test.ts src/game/bake.test.ts`
Expected: FAIL — `AssertionError: mario uair: expected 30 to be 32 // Object.is equality` (the bake still holds the legacy uair's clock) and `AssertionError: mario: expected [ 'jab1', 'dashAttack', 'dair', …(2) ] to deeply equal ArrayContaining{…}` (installing the bake does not yet record the limb slots).

- [ ] **Step 5: Bake the game's fighters, record the slots, regenerate** — `src/render3d/bake/roster.ts` (whole file):

```ts
/**
 * The whole roster's bake, from the committed skeletons (`src/render3d/skeletons/`)
 * and the fighters as the game plays them: `withLimbScripts(def)`, so an
 * adopted limb-bone move is baked on its imported script's motion and length,
 * not the legacy move it replaced (mario uair: 32 motion frames, not 30). `roster.test.ts` writes it to
 * `public/bake/roster.bin.gz` under `UPDATE_BAKE=1` and otherwise proves the
 * committed file is exactly what the current clips, scripts and skeletons bake to.
 */

import type { BakedFighter } from "@/engine/acmd/bakeCodec";
import { FIGHTERS } from "@/fighters";
import { REFERENCE_SCRIPTS } from "@/fighters/acmd";
import { withLimbScripts } from "@/fighters/acmd/limb";
import type { SkeletonFile } from "../skeleton/skeleton";
import { scriptBoneNames } from "@/engine/acmd/scriptBones";
import { bakeFighter } from "./bake";

/** Every bone any of a fighter's reference scripts names (lower case, `top` excluded). */
export function referenceScriptBones(fighterId: string): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(REFERENCE_SCRIPTS[fighterId]?.scripts ?? {})) {
    for (const b of scriptBoneNames(s.commands)) out.add(b);
  }
  return out;
}

export function bakeRoster(skeletons: Readonly<Record<string, SkeletonFile>>): BakedFighter[] {
  return FIGHTERS.map((def) => {
    const skeleton = skeletons[def.id];
    if (skeleton === undefined) throw new Error(`bake: no committed skeleton for ${def.id} (run pnpm models)`);
    return bakeFighter({ def: withLimbScripts(def), skeleton, scriptBones: referenceScriptBones(def.id) });
  });
}
```

`src/game/simContext.ts` — replace `export const GAME_ENGINE_RULES: EngineRules = { version: ENGINE_RULES_VERSION, activeSlots: ACTIVE_SCRIPT_SLOTS };` with

```ts
/**
 * Mutable like `GAME_SIM_CONTEXT`: `installBake` (Plan 4) adds the limb-bone
 * slots it switches on (`LIMB_SCRIPT_SLOTS`), so a build with a different
 * `limb.json` has a different fingerprint even when its bake is the same.
 */
export const GAME_ENGINE_RULES: { -readonly [K in keyof EngineRules]: EngineRules[K] } = {
  version: ENGINE_RULES_VERSION,
  activeSlots: ACTIVE_SCRIPT_SLOTS,
};

/** Two slot tables as one: every slot either runs, each fighter's in a stable order. */
export function mergeSlots(
  a: Readonly<Record<string, readonly MoveSlot[]>>,
  b: Readonly<Record<string, readonly MoveSlot[]>>,
): Record<string, readonly MoveSlot[]> {
  const out: Record<string, readonly MoveSlot[]> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[id] = [...new Set([...(a[id] ?? []), ...(b[id] ?? [])])];
  }
  return out;
}
```

`src/game/bake.ts` (whole file now):

```ts
/**
 * Loading the bake in the browser (Plan 4).
 *
 * `public/bake/roster.bin.gz` is fetched once, gunzipped with the platform's
 * `DecompressionStream`, checked against the digest compiled into this build
 * (`BAKE_DIGEST`) and decoded into the tables the sim reads. A file that does
 * not match is refused: a stale cached bake would put hitboxes somewhere other
 * than where this build's renderer draws limbs, and online it would desync.
 */

import { decodeBake } from "@/engine/acmd/bakeCodec";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import { BAKE_BYTES, BAKE_DIGEST } from "@/fighters/bake/digest";
import { registryContext, type SimContext } from "@/engine/simulate";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "@/fighters/acmd/limb";
import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, mergeSlots } from "./simContext";

export const BAKE_URL = "/bake/roster.bin.gz";

export type FetchLike = (url: string) => Promise<Pick<Response, "ok" | "status" | "body">>;

async function gunzip(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const stream = body.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch, verify and decode the bake. Rejects with a sentence a player can read. */
export async function fetchBake(fetchFn: FetchLike = (u) => fetch(u, { cache: "no-cache" })): Promise<BakeTables> {
  const res = await fetchFn(BAKE_URL);
  if (!res.ok || res.body === null) throw new Error(`Could not load the fighters' animation data (HTTP ${res.status}).`);
  const bytes = await gunzip(res.body);
  if (bytes.length !== BAKE_BYTES || (await sha256Hex(bytes)) !== BAKE_DIGEST) {
    throw new Error("The fighters' animation data does not match this version of the game. Reload the page.");
  }
  return bakeTables(decodeBake(bytes), BAKE_DIGEST);
}

/**
 * The game's context over `base` with the bake in it: baked bones for hitboxes
 * and the online fingerprint, clocks and hurtboxes for the bone hurtboxes and
 * ECB, and the fighters with their adopted limb-bone scripts (Task 14), which
 * only a bake can place.
 */
export function bakedContext(base: Pick<SimContext, "fighter" | "stage">, tables: BakeTables): SimContext {
  return {
    fighter: (id) => withLimbScripts(base.fighter(id)),
    stage: (id) => base.stage(id),
    bones: tables.bones,
    bake: tables,
  };
}

/**
 * Put the bake into Plan 2's `GAME_SIM_CONTEXT`, which every match steps with,
 * and the limb-bone slots it switches on into `GAME_ENGINE_RULES`, so the
 * online fingerprint covers `limb.json` as well as the bones.
 */
export function installBake(tables: BakeTables): void {
  const ctx = bakedContext(registryContext, tables);
  GAME_SIM_CONTEXT.fighter = ctx.fighter;
  GAME_SIM_CONTEXT.bones = ctx.bones;
  GAME_SIM_CONTEXT.bake = ctx.bake;
  GAME_ENGINE_RULES.activeSlots = mergeSlots(ACTIVE_SCRIPT_SLOTS, LIMB_SCRIPT_SLOTS);
}

let loading: Promise<BakeTables> | null = null;

/** The bake, fetched at most once per page; a failed fetch may be retried. */
export function loadBake(fetchFn?: FetchLike): Promise<BakeTables> {
  if (loading === null) {
    loading = fetchBake(fetchFn).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** Load the bake (once) and install it in `GAME_SIM_CONTEXT`; what every page awaits before a match. */
export async function ensureBakeInstalled(fetchFn?: FetchLike): Promise<BakeTables> {
  const tables = await loadBake(fetchFn);
  installBake(tables);
  return tables;
}
```

`src/game/golden.test.ts` — after the comment line `// Measured when written: hits 16/14/12/20, shield hits 1/0/1/2, KOs 1/3/1/0.` (change its final `.` to `;`) add `// with the Plan 4 bake (SSBU sizes): hits 21/22/13/22, shield hits 0/1/2/1, KOs 2/2/2/1.`

Then (one command per line: the Bash tool's zsh does not word-split a variable holding several):

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
```
Expected: `digest.ts` reads `BAKE_DIGEST = "2083d93d09334cb630c848a8fb9a52fe1f6c572ed1dc5fbc8cd1d60a5601b9ea"`, `BAKE_BYTES = 5456779` (1,575,927 bytes gzipped) — verified in scratch, so a different value means this tree differs from the plan's; `git diff --stat super-smash/src/fighters/acmd/reconcile.allow.json` shows **17 deletions and no insertions** (the switched-on slots' disagreements; an added line means a slot that is not switched on changed — a bug in this task); `reach.allow.json` is exactly

```json
{
  "mario bair": "legacy -1.9 / baked 3.4",
  "mario fair": "legacy 9.8 / baked 5.2",
  "mario jab2": "legacy 7.4 / baked 10.8",
  "mario jab3": "legacy 8.9 / baked 17.3",
  "donkeyKong bair": "legacy -4.5 / baked 10.1",
  "donkeyKong fair": "legacy 14.0 / baked 26.5",
  "donkeyKong jab1": "legacy 11.5 / baked 15.5",
  "donkeyKong jab2": "legacy 11.0 / baked 21.4",
  "donkeyKong nair": "legacy 11.0 / baked 25.6",
  "link bair": "legacy -4.0 / baked 5.6",
  "link jab3": "legacy 11.3 / baked 19.5",
  "link nair": "legacy 9.5 / baked 13.7",
  "samus dair": "legacy 5.5 / baked 10.8",
  "samus dtilt": "legacy 10.5 / baked 21.6",
  "samus fair": "legacy 10.5 / baked 18.1",
  "samus jab2": "legacy 10.5 / baked 13.8",
  "samus nair": "legacy 9.5 / baked 16.0",
  "samus utilt": "legacy 5.0 / baked 10.3",
  "kirby dtilt": "legacy 6.0 / baked 13.5",
  "kirby nair": "legacy 4.0 / baked 9.3",
  "fox dair": "legacy 4.4 / baked 10.0",
  "fox ftilt": "legacy 9.6 / baked 13.3",
  "fox uair": "legacy 4.5 / baked 7.7",
  "pikachu bair": "legacy -0.8 / baked 5.5",
  "pikachu dair": "legacy 3.0 / baked 11.0",
  "pikachu dashAttack": "legacy 6.6 / baked 11.7",
  "marth dtilt": "legacy 13.2 / baked 18.4"
}
```

Review `reach.allow.json` before committing: for each entry open the move in `/anim` (3D from Task 21; the 2D lab shows the same clip until then) and either accept it (the model's size, D57, or Ultimate's own reach differing from the legacy transcription — D17's list) or fix the clip in `src/render/chars/<id>/poses.ts`, then repeat this step from the re-bake.

- [ ] **Step 6: Run the tests and the gate**

Run: `pnpm vitest run src/fighters src/game src/render3d/bake && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS (`roster.test.ts` 5 tests, `bake.test.ts` 4, `limb.test.ts` 3); exit 0. If any suite fails with `no pose for bone "<b>"`, it steps a fighter from `bakedContext`/`GAME_SIM_CONTEXT` with a context that has no bake: give it `bakedContext(…, readBakeFromDisk())`, as `golden.test.ts` has.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/fighters/acmd/active.ts super-smash/src/fighters/acmd/limb.ts super-smash/src/fighters/acmd/limb.test.ts super-smash/src/fighters/acmd/limb.json super-smash/src/fighters/acmd/reach.test.ts super-smash/src/fighters/acmd/reach.allow.json super-smash/src/fighters/acmd/reconcile.test.ts super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/render3d/bake/roster.ts super-smash/src/render3d/bake/roster.test.ts super-smash/src/game/bake.ts super-smash/src/game/bake.test.ts super-smash/src/game/simContext.ts super-smash/public/bake/roster.bin.gz super-smash/src/fighters/bake/digest.ts super-smash/src/game/golden.test.ts super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: run the published limb-bone game_ scripts in the game" -m "Plan 3's activatable rule, widened from the root bone to every bone in the committed skeletons: 53 slots (limb.json) run their imported script in the game's context, hitboxes on the limbs the bake places. The bake now bakes the game's fighters, so an adopted move's clock is its script's (Mario uair 32 frames, not 30); installBake adds the slots to the engine rules, so the online fingerprint covers limb.json. reconcile.allow.json loses 17 entries; reach.allow.json lists the 27 moves whose reach moved over 3 units or 30% at SSBU sizes, reviewed. Bake and golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: three.js, and a side camera framed by the existing 2D camera

`render/camera.ts` already decides where the view is and how far it zooms (fighters in frame, KO punch-in, shake), in pixels per unit. A perspective camera looking down −Z maps the z = 0 plane — where the sim lives — linearly onto the screen, so placing it at the distance where one unit is `zoom` pixels puts every sim point exactly where `worldToScreen` does. The 2D overlay therefore lines up with the 3D fighters by construction, while depth keeps Ultimate's gentle perspective (26° vertical FOV, UNVERIFIED: by eye). `shakeAngle` is not applied (the 2D renderer never applied it either).

**Files:**
- Create: `super-smash/src/render3d/camera3d.ts`, `super-smash/src/render3d/camera3d.test.ts`
- Modify: `super-smash/package.json`, `super-smash/pnpm-lock.yaml`

**Interfaces:**
- Produces: `SIDE_FOV_DEG = 26`, `SideCameraPose { x; y; z; fov; near; far }`, `sideCameraPose(cam, fovDeg?)`, `createSideCamera(): PerspectiveCamera`, `applySideCamera(three, cam)`.

- [ ] **Step 1: Install three** (0.186.1 published 2026-09-24; types 0.186.0 published 2026-09-11)

Run: `pnpm add three@0.186.1 && pnpm add -D @types/three@0.186.0`
Expected: added. three is imported only from `src/render3d/**`, `src/game/world3d.ts` and `src/app/anim/Lab3D.tsx`, each reached through a dynamic `import()` from a client component (Task 20), so it never enters the server bundle or the menus' chunks.

- [ ] **Step 2: Write the failing test** — `src/render3d/camera3d.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { VIEW_HEIGHT, VIEW_WIDTH, createCamera, worldToScreen } from "@/render/camera";
import { applySideCamera, createSideCamera, sideCameraPose } from "./camera3d";

/** Project a world point through the three.js camera into 1920×1080 pixels. */
function project(three: ReturnType<typeof createSideCamera>, x: number, y: number, z = 0) {
  const v = new Vector3(x, y, z).project(three);
  return { x: ((v.x + 1) / 2) * VIEW_WIDTH, y: ((1 - v.y) / 2) * VIEW_HEIGHT };
}

describe("the 3D side camera", () => {
  it("puts every point of the sim's plane exactly where the 2D overlay draws it", () => {
    const cam = { ...createCamera(null), x: 12, y: 30, zoom: 7.5, shakeX: 14, shakeY: -9 };
    const three = createSideCamera();
    applySideCamera(three, cam);
    for (const [wx, wy] of [[0, 0], [12, 30], [-80, 5], [60, 90], [-200, -100]]) {
      const got = project(three, wx, wy);
      const want = worldToScreen(cam, wx, wy);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it("shows nearer things bigger: a fighter's near side is in front of the plane", () => {
    const cam = { ...createCamera(null), x: 0, y: 0, zoom: 10, shakeX: 0, shakeY: 0 };
    const three = createSideCamera();
    applySideCamera(three, cam);
    const near = project(three, 5, 0, 3);
    const flat = project(three, 5, 0, 0);
    expect(near.x - VIEW_WIDTH / 2).toBeGreaterThan(flat.x - VIEW_WIDTH / 2);
  });

  it("backs away as the 2D camera zooms out, keeping the stage between near and far", () => {
    const close = sideCameraPose({ x: 0, y: 0, zoom: 15, shakeX: 0, shakeY: 0 });
    const wide = sideCameraPose({ x: 0, y: 0, zoom: 3.6, shakeX: 0, shakeY: 0 });
    expect(wide.z).toBeGreaterThan(close.z * 4);
    for (const p of [close, wide]) {
      expect(p.near).toBeLessThan(p.z - 40);
      expect(p.far).toBeGreaterThan(p.z + 200);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/camera3d.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./camera3d" from "src/render3d/camera3d.test.ts". Does the file exist?`

- [ ] **Step 4: Implement** — `src/render3d/camera3d.ts`:

```ts
/**
 * The 3D side camera, framed by the existing 2D camera (`render/camera.ts`).
 *
 * `camera.ts` already decides where the view is and how far it is zoomed —
 * fighters in frame, KO punch-in, shake — in screen pixels per world unit. A
 * perspective camera looking down −Z maps the z = 0 plane (where the sim lives)
 * linearly onto the screen, so placing it at the distance where one world unit
 * is `zoom` pixels makes every point on that plane land exactly where
 * `worldToScreen` says. The 2D overlay (HUD, projectiles, move effects, the
 * magnifying glass) therefore lines up with the 3D fighters by construction,
 * while depth — the stage's front face, the far side of a body — still gets
 * Ultimate's gentle perspective.
 */

import { PerspectiveCamera } from "three";

import { VIEW_HEIGHT, VIEW_WIDTH, type Camera } from "@/render/camera";

/** Vertical field of view, degrees. Narrow, like Ultimate's side camera. UNVERIFIED: tuned by eye. */
export const SIDE_FOV_DEG = 26;

export interface SideCameraPose {
  readonly x: number;
  readonly y: number;
  /** Distance from the z = 0 plane. */
  readonly z: number;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
}

/** Where the 3D camera sits for a 2D camera state. Pure. */
export function sideCameraPose(cam: Pick<Camera, "x" | "y" | "zoom" | "shakeX" | "shakeY">, fovDeg = SIDE_FOV_DEG): SideCameraPose {
  const half = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const z = VIEW_HEIGHT / 2 / (cam.zoom * half);
  return {
    // worldToScreen adds the shake in pixels; moving the camera the other way by
    // the same distance in units is the same picture.
    x: cam.x - cam.shakeX / cam.zoom,
    y: cam.y + cam.shakeY / cam.zoom,
    z,
    fov: fovDeg,
    near: Math.max(0.5, z * 0.25),
    far: z + 800,
  };
}

export function createSideCamera(): PerspectiveCamera {
  return new PerspectiveCamera(SIDE_FOV_DEG, VIEW_WIDTH / VIEW_HEIGHT, 1, 1000);
}

/** Point a three.js camera where `sideCameraPose` says. */
export function applySideCamera(three: PerspectiveCamera, cam: Pick<Camera, "x" | "y" | "zoom" | "shakeX" | "shakeY">): void {
  const p = sideCameraPose(cam, three.fov);
  three.position.set(p.x, p.y, p.z);
  three.near = p.near;
  three.far = p.far;
  three.aspect = VIEW_WIDTH / VIEW_HEIGHT;
  three.lookAt(p.x, p.y, 0);
  three.updateProjectionMatrix();
  three.updateMatrixWorld();
}
```

- [ ] **Step 5: Run it again**

Run: `pnpm vitest run src/render3d/camera3d.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full gate, and the build** (three must not break the static export)

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: exit 0; `out/` produced as before.

- [ ] **Step 7: Commit**

```bash
git add super-smash/package.json super-smash/pnpm-lock.yaml super-smash/src/render3d/camera3d.ts super-smash/src/render3d/camera3d.test.ts
git commit -m "super-smash: three.js 0.186.1 and a side camera framed by the 2D camera" -m "A perspective camera placed where one unit is camera.zoom pixels maps the sim's plane exactly onto worldToScreen, so the 2D overlay (HUD, projectiles, move effects) lines up with the 3D world by construction." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The stage in 3D, generated from the sim's platforms

**Files:**
- Create: `super-smash/src/render3d/stage3d.ts`, `super-smash/src/render3d/stage3d.test.ts`
- Modify: `super-smash/src/render/stageArt.ts` (export `stagePaintFor`)

**Interfaces:**
- Consumes: `platformCentreX` (`physics.ts`), `StageDef`, `Platform`.
- Produces: `stagePaintFor(stage)` (`stageArt.ts`); `MAIN_DEPTH = 46`, `SOFT_THICKNESS = 1.2`, `MAIN_DEPTH_Z = 36`, `SOFT_DEPTH_Z = 18`, `prismGeometry(half, height, taper, depthZ, top, side, bottom)`, `Stage3D { group; update(frame); dispose() }`, `createStage3D(stage)`.

- [ ] **Step 1: Write the failing test** — `src/render3d/stage3d.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Box3, Mesh } from "three";

import { toFloat } from "@/engine/fixed";
import { platformCentreX } from "@/engine/physics";
import { STAGES } from "@/stages";
import { createStage3D } from "./stage3d";

const meshes = (s: ReturnType<typeof createStage3D>) => s.group.children.filter((c): c is Mesh => c instanceof Mesh);

describe("3D stages from the sim's platforms", () => {
  it("puts every platform's top surface exactly where the sim lands fighters", () => {
    for (const stage of STAGES) {
      const s = createStage3D(stage);
      const ms = meshes(s);
      expect(ms.length, stage.id).toBe(stage.platforms.length);
      ms.forEach((m, i) => {
        const p = stage.platforms[i];
        const box = new Box3().setFromObject(m);
        expect(box.max.y).toBeCloseTo(toFloat(p.y), 6);
        expect(box.max.x - box.min.x).toBeCloseTo(2 * toFloat(p.halfWidth), 6);
      });
      s.dispose();
    }
  });

  it("moves a moving platform with the sim's own platformCentreX", () => {
    const stage = STAGES.find((st) => st.platforms.some((p) => p.motion))!;
    const s = createStage3D(stage);
    const i = stage.platforms.findIndex((p) => p.motion);
    for (const frame of [0, 37, 240, 999]) {
      s.update(frame);
      expect(meshes(s)[i].position.x).toBeCloseTo(toFloat(platformCentreX(stage.platforms[i], frame)), 9);
    }
    s.dispose();
  });

  it("costs one draw call per platform and frees its GPU buffers on dispose", () => {
    const stage = STAGES[0];
    const s = createStage3D(stage);
    const ms = meshes(s);
    const spies = ms.map((m) => vi.spyOn(m.geometry, "dispose"));
    const material = vi.spyOn(ms[0].material as { dispose(): void }, "dispose");
    s.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(s.group.children).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/stage3d.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./stage3d" from "src/render3d/stage3d.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/render/stageArt.ts`, immediately after the `/* ---…--- painting -- */` banner:

```ts
/** A stage's colours, shared by the 2D background and the 3D platforms (Plan 4). */
export function stagePaintFor(stage: Pick<StageDef, "theme">): StagePaint {
  return PAINTS[themeFor(stage.theme)];
}
```

`src/render3d/stage3d.ts`:

```ts
/**
 * The stage in 3D: one solid per platform, generated from the sim's own
 * platform rectangles (`StageDef.platforms`), so the surface a fighter stands on
 * is the surface the sim lands them on — no art to drift out of step.
 *
 * A main platform is a prism whose top is the walkable surface and whose body
 * tapers to 62% of its width over `MAIN_DEPTH` units below (the silhouette the
 * 2D stage art drew); a soft platform is a thin slab. Each is one mesh with
 * vertex colours from the stage's palette (`stagePaintFor`), so a whole stage
 * is one draw call per platform — Battlefield is four.
 *
 * Moving platforms are placed every frame with `platformCentreX`, the sim's own
 * function, rather than the 2D art's float sine, so they never disagree.
 */

import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from "three";

import { toFloat } from "@/engine/fixed";
import { platformCentreX } from "@/engine/physics";
import type { Platform, StageDef } from "@/engine/types";
import { stagePaintFor } from "@/render/stageArt";

export const MAIN_DEPTH = 46;
export const SOFT_THICKNESS = 1.2;
/** How far a platform reaches toward and away from the camera, in units. UNVERIFIED: by eye. */
export const MAIN_DEPTH_Z = 36;
export const SOFT_DEPTH_Z = 18;

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * A tapered prism centred on x = 0: top face at y = 0 from −half to +half,
 * bottom face at y = −height from −half·taper to +half·taper, ±depthZ/2 deep.
 * Non-indexed so each face carries its own colour and flat normal.
 */
export function prismGeometry(half: number, height: number, taper: number, depthZ: number, top: Rgb, side: Rgb, bottom: Rgb): BufferGeometry {
  const z0 = -depthZ / 2;
  const z1 = depthZ / 2;
  const b = half * taper;
  const P = {
    tlf: [-half, 0, z1], trf: [half, 0, z1], tlb: [-half, 0, z0], trb: [half, 0, z0],
    blf: [-b, -height, z1], brf: [b, -height, z1], blb: [-b, -height, z0], brb: [b, -height, z0],
  } as const;
  const quads: [readonly number[], readonly number[], readonly number[], readonly number[], Rgb][] = [
    [P.tlb, P.tlf, P.trf, P.trb, top],
    [P.tlf, P.blf, P.brf, P.trf, side],
    [P.trb, P.brb, P.blb, P.tlb, side],
    [P.tlb, P.blb, P.blf, P.tlf, side],
    [P.trf, P.brf, P.brb, P.trb, side],
    [P.blf, P.blb, P.brb, P.brf, bottom],
  ];
  const pos: number[] = [];
  const col: number[] = [];
  for (const [a, b2, c, d, colour] of quads) {
    for (const v of [a, b2, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      col.push(...colour);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

export interface Stage3D {
  readonly group: Group;
  /** Place moving platforms for sim frame `frame`. */
  update(frame: number): void;
  dispose(): void;
}

export function createStage3D(stage: StageDef): Stage3D {
  const paint = stagePaintFor(stage);
  const material = new MeshLambertMaterial({ vertexColors: true });
  const group = new Group();
  group.name = `stage:${stage.id}`;
  const placed: { mesh: Mesh; platform: Platform }[] = [];
  for (const platform of stage.platforms) {
    const half = toFloat(platform.halfWidth);
    const geometry = platform.soft
      ? prismGeometry(half, SOFT_THICKNESS, 1, SOFT_DEPTH_Z, rgb(paint.softEdge), rgb(paint.soft), rgb(paint.soft))
      : prismGeometry(half, MAIN_DEPTH, 0.62, MAIN_DEPTH_Z, rgb(paint.top), rgb(paint.face), rgb(paint.deep));
    const mesh = new Mesh(geometry, material);
    mesh.position.set(toFloat(platform.x), toFloat(platform.y), 0);
    mesh.receiveShadow = true;
    group.add(mesh);
    placed.push({ mesh, platform });
  }
  return {
    group,
    update(frame) {
      for (const { mesh, platform } of placed) {
        if (platform.motion) mesh.position.x = toFloat(platformCentreX(platform, frame));
      }
    },
    dispose() {
      for (const { mesh } of placed) mesh.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render3d/stage3d.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render3d/stage3d.ts super-smash/src/render3d/stage3d.test.ts super-smash/src/render/stageArt.ts
git commit -m "super-smash: 3D stages generated from the sim's own platforms" -m "One vertex-coloured prism per platform in the stage's palette, top surface exactly where the sim lands fighters; moving platforms follow platformCentreX, the sim's own function. One draw call per platform." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Load fighter models lazily, never fatally

A model that fails is drawn as a stand-in **for that match only**: the cache forgets it, so the next match asks again (a network blip must not cost a fighter their model for the rest of the session; a fighter simply not in the index is asked again too, at the price of one cheap lookup). Every glb is checked against its index entry — length and SHA-256 — before the decoder sees it: the index is the build's record of what it shipped, and a stale CDN copy or a truncated download is refused, not drawn. `preload` lets the online lobby start the downloads as soon as both picks are known (Task 20).

**Files:**
- Create: `super-smash/src/render3d/models/loader.ts`, `super-smash/src/render3d/models/loader.test.ts`

**Interfaces:**
- Produces: `MODEL_INDEX_URL = "/models/index.json"`, `MODEL_INDEX_SCHEMA = 1`, `ModelIndexEntry { file; bytes; sha256 }`, `ModelIndex`, `parseModelIndex(json): ModelIndex | null` (file names must match `<id>.<8 hex>.glb`), `ModelSource { index(); load(entry: ModelIndexEntry) }`, `verifyModelBytes(bytes, entry): Promise<void>` (rejects `<file>: <n> bytes, index says <m>` or `<file>: SHA-256 does not match the model index`), `LoadedModel = { kind: "glb"; scene } | { kind: "standIn"; reason }`, `ModelCache { get(fighterId); preload(fighterIds): Promise<void>; status() }`, `MODEL_TIMEOUT_MS = 20000`, `createModelCache(source, warn?, ms?)`, `browserModelSource(fetchFn?)` (fetch the bytes, verify them, then `GLTFLoader.parseAsync` + `MeshoptDecoder`, both dynamically imported).

- [ ] **Step 1: Write the failing test** — `src/render3d/models/loader.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Group } from "three";

import { createHash } from "node:crypto";

import { createModelCache, parseModelIndex, verifyModelBytes, type ModelSource } from "./loader";

const INDEX = { schema: 1, models: { mario: { file: "mario.0123abcd.glb", bytes: 1, sha256: "x" } } } as const;

function source(over: Partial<ModelSource> = {}): ModelSource {
  return { index: async () => parseModelIndex(INDEX), load: async () => new Group(), ...over };
}

describe("loading fighter models (never fatal)", () => {
  it("loads a listed model once and shares it", async () => {
    const load = vi.fn(async () => new Group());
    const cache = createModelCache(source({ load }), () => {});
    const [a, b] = await Promise.all([cache.get("mario"), cache.get("mario")]);
    expect(a.kind).toBe("glb");
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledOnce();
    expect(cache.status()).toEqual({ mario: "glb" });
  });

  it("stands a fighter in when the index is missing — a checkout that never ran pnpm models", async () => {
    const warn = vi.fn();
    const cache = createModelCache(source({ index: async () => null }), warn);
    expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "no model index (run pnpm models)" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pnpm models"));
  });

  it("stands a fighter in when its glb is corrupt or 404s, and the others still load", async () => {
    const cache = createModelCache(
      source({
        index: async () => parseModelIndex({ schema: 1, models: { ...INDEX.models, fox: { file: "fox.89abcdef.glb", bytes: 1, sha256: "y" } } }),
        load: async (entry) => {
          if (entry.file.startsWith("fox")) throw new Error("Unexpected token in glTF JSON");
          return new Group();
        },
      }),
      () => {},
    );
    expect((await cache.get("fox")).kind).toBe("standIn");
    expect((await cache.get("mario")).kind).toBe("glb");
  });

  it("gives up on a hung download and starts with the stand-in", async () => {
    vi.useFakeTimers();
    const cache = createModelCache(source({ load: () => new Promise(() => {}) }), () => {}, 1000);
    const got = cache.get("mario");
    await vi.advanceTimersByTimeAsync(1001);
    expect((await got).kind).toBe("standIn");
    vi.useRealTimers();
  });

  it("tries a failed model again next match instead of standing it in for the rest of the page", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("network error")).mockResolvedValue(new Group());
    const index = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(parseModelIndex(INDEX));
    const cache = createModelCache(source({ load, index }), () => {});
    expect((await cache.get("mario")).kind).toBe("standIn"); // index unreachable
    expect((await cache.get("mario")).kind).toBe("standIn"); // index back, glb fails
    expect((await cache.get("mario")).kind).toBe("glb"); // third match: loaded
    expect(await cache.get("mario")).toBe(await cache.get("mario")); // and kept
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("preloads a lobby's fighters so the match starts with them", async () => {
    const load = vi.fn(async () => new Group());
    const cache = createModelCache(source({ load }), () => {});
    await cache.preload(["mario", "mario"]);
    expect(load).toHaveBeenCalledOnce();
    expect(cache.status()).toEqual({ mario: "glb" });
  });

  it("refuses an index whose file names could reach outside /models/", () => {
    expect(parseModelIndex({ schema: 1, models: { mario: { file: "../secrets.glb", bytes: 1, sha256: "" } } })).toBeNull();
    expect(parseModelIndex({ schema: 2, models: {} })).toBeNull();
  });
});

describe("checking a downloaded glb against its index entry", () => {
  const bytes = new TextEncoder().encode("glTF fake body").buffer;
  const entry = { file: "mario.0123abcd.glb", bytes: bytes.byteLength, sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex") };

  it("passes the bytes the index names", async () => {
    await expect(verifyModelBytes(bytes, entry)).resolves.toBeUndefined();
  });

  it("refuses a truncated or stale file before the decoder sees it", async () => {
    await expect(verifyModelBytes(bytes.slice(0, 4), entry)).rejects.toThrow(/4 bytes, index says 14/);
    await expect(verifyModelBytes(bytes, { ...entry, sha256: "0".repeat(64) })).rejects.toThrow(/SHA-256 does not match/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/models`
Expected: FAIL — `Error: Failed to resolve import "./loader" from "src/render3d/models/loader.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/render3d/models/loader.ts`:

```ts
/**
 * Fighter models: fetched lazily, cached per page, and never fatal.
 *
 * The glbs are built locally by `pnpm models` into the git-ignored
 * `public/models/` (spec §3.1), indexed by `public/models/index.json`. A
 * checkout that never ran `pnpm models`, a glb that 404s, a truncated download
 * or a decoder failure all end the same way: that fighter is drawn as a
 * stand-in made of its own hurtbox capsules (`standIn.ts`) and the match plays
 * on. A renderer that throws takes the match with it (D29); a capsule does not.
 * A stand-in is for this match only: the next match asks again, so one network
 * blip does not cost a fighter their model for the rest of the session.
 *
 * Every glb is checked against its index entry (length and SHA-256) before the
 * decoder sees it: the index is the build's record of what it shipped.
 */

import type { Object3D } from "three";

export const MODEL_INDEX_URL = "/models/index.json";
export const MODEL_INDEX_SCHEMA = 1;

export interface ModelIndexEntry {
  /** File name under /models/, content-hashed: `mario.3f9c2a1b.glb`. */
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ModelIndex {
  readonly schema: typeof MODEL_INDEX_SCHEMA;
  readonly models: Readonly<Record<string, ModelIndexEntry>>;
}

export function parseModelIndex(json: unknown): ModelIndex | null {
  const o = json as Partial<ModelIndex> | null;
  if (o === null || typeof o !== "object" || o.schema !== MODEL_INDEX_SCHEMA || typeof o.models !== "object" || o.models === null) {
    return null;
  }
  for (const e of Object.values(o.models)) {
    if (typeof e?.file !== "string" || !/^[a-zA-Z0-9]+\.[0-9a-f]{8}\.glb$/.test(e.file)) return null;
  }
  return o as ModelIndex;
}

/** Where models come from: the network in the browser, a fake in tests. */
export interface ModelSource {
  index(): Promise<ModelIndex | null>;
  /** The glb's scene, ready to clone; rejects if the bytes are not the entry's. */
  load(entry: ModelIndexEntry): Promise<Object3D>;
}

/** Resolves when `bytes` are exactly what `entry` lists; rejects naming what differs. */
export async function verifyModelBytes(bytes: ArrayBuffer, entry: ModelIndexEntry): Promise<void> {
  if (bytes.byteLength !== entry.bytes) throw new Error(`${entry.file}: ${bytes.byteLength} bytes, index says ${entry.bytes}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== entry.sha256) throw new Error(`${entry.file}: SHA-256 does not match the model index`);
}

export type LoadedModel =
  | { readonly kind: "glb"; readonly scene: Object3D }
  | { readonly kind: "standIn"; readonly reason: string };

export interface ModelCache {
  get(fighterId: string): Promise<LoadedModel>;
  /** Start loading these fighters now (the online lobby, once picks are known); resolves when each has settled. */
  preload(fighterIds: readonly string[]): Promise<void>;
  /** What each requested fighter resolved to so far, for `__smashRender.info()`. */
  status(): Readonly<Record<string, "loading" | "glb" | "standIn">>;
}

/** How long a model may take before the match starts with its stand-in. */
export const MODEL_TIMEOUT_MS = 20_000;

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}

export function createModelCache(source: ModelSource, warn: (msg: string) => void = console.warn, ms = MODEL_TIMEOUT_MS): ModelCache {
  let index: Promise<ModelIndex | null> | null = null;
  const models = new Map<string, Promise<LoadedModel>>();
  const state: Record<string, "loading" | "glb" | "standIn"> = {};
  const standIn = (id: string, reason: string): LoadedModel => {
    warn(`David-Smash: drawing ${id} as a stand-in — ${reason}`);
    state[id] = "standIn";
    // Forget it, so the next match tries again (and the index too, if that was what failed).
    models.delete(id);
    return { kind: "standIn", reason };
  };
  const get = (id: string): Promise<LoadedModel> => {
    let m = models.get(id);
    if (m === undefined) {
      state[id] = "loading";
      const idx = (index ??= source.index().catch(() => null));
      m = idx.then(async (found) => {
        if (found === null) {
          if (index === idx) index = null;
          return standIn(id, "no model index (run pnpm models)");
        }
        const entry = found.models[id];
        if (entry === undefined) return standIn(id, "not in the model index");
        try {
          const scene = await timeout(source.load(entry), ms, entry.file);
          state[id] = "glb";
          return { kind: "glb", scene } as const;
        } catch (e) {
          return standIn(id, `${entry.file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      models.set(id, m);
    }
    return m;
  };
  return {
    get,
    async preload(ids) {
      await Promise.all([...new Set(ids)].map(get));
    },
    status: () => ({ ...state }),
  };
}

/** The browser source: `fetch` for the index and the bytes, checked, then `GLTFLoader` + meshopt. */
export function browserModelSource(fetchFn: typeof fetch = (u, init) => fetch(u, init)): ModelSource {
  return {
    async index() {
      const res = await fetchFn(MODEL_INDEX_URL, { cache: "no-cache" });
      if (!res.ok) return null;
      return parseModelIndex(await res.json());
    },
    async load(entry) {
      const res = await fetchFn(`/models/${entry.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      await verifyModelBytes(bytes, entry);
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(bytes, "/models/");
      return gltf.scene;
    },
  };
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render3d/models`
Expected: PASS (9 tests). "tries a failed model again next match" is the one that pins the retry: with the cache keeping its first stand-in, its third `get` returns `standIn` and it fails `expected 'standIn' to be 'glb'`.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render3d/models/loader.ts super-smash/src/render3d/models/loader.test.ts
git commit -m "super-smash: load fighter glbs lazily, verified, and stand a fighter in when one fails" -m "A missing index (no pnpm models), a 404, a corrupt or stale file (length and SHA-256 checked against the index) or a 20 s hang each give that fighter a stand-in for that match and a console line saying why; the next match tries again, and the others still load. preload starts a lobby's downloads early. The index can only name files of the form id.sha8.glb under /models/." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: A fighter in 3D — posed exactly as the bake, turned to face, flashed and blinked

The renderer evaluates the *same* clock (`poseIndexOf`), sampler, retargeter and root transform as the bake, then hands the local pose to the model's bones by SSBU name (case-insensitive). `fighterPose.test.ts` is the guarantee the plan rests on: for every motion and frame of every fighter, three.js's bone world matrices, projected, equal the committed bake within its quantum. The drawn limbs index the bake by the **sim's** clock (`f.actionFrame`), not by the 2D renderer's `clipFrameFor`, which restarts a clip the action did not restart: a fast fall pressed twenty frames into a fall would otherwise be drawn at the dive's frame 0 while the hurtboxes sit at its frame 20 — up to 30 frames apart (the clip is "once" over 30). In 3D the limbs are the hurtboxes, so the 3D dive is entered where the sim has it (the 2D renderer keeps its snap). One deliberate difference stays (D42): a change of clip fades over four frames except into an attack or an imposed state; the sim has no fade, so during those frames a hurtbox may lead the drawn body slightly — hitboxes never can, because attacks never fade. The tests use the game's fighters (`withLimbScripts`), as the bake and the play page do. Facing is a real ±90° turn about +Y (SSBU turns its fighters; a left-facing Link holds his sword in the same hand), which leaves every bone's side-plane position unchanged, so the sim's mirrored hitbox sits on the drawn limb. The material is a three-band `MeshToonMaterial` with a view-facing rim spliced into three's own toon shader, alpha-tested rather than blended (eyes and hair cards never sort behind the face); D21's white hit flash drives the emissive; intangibility blinks opacity as the 2D figure did. `squashFor` (the 2D landing/hitlag squash) is not applied — Ultimate does not squash, and it would make the drawn body disagree with the baked one; `hitlagShake` is (a position jitter, not a pose).

**Files:**
- Create: `super-smash/src/render3d/threeRig.ts`, `super-smash/src/render3d/toon.ts`, `super-smash/src/render3d/toon.test.ts`, `super-smash/src/render3d/fighterPose.ts`, `super-smash/src/render3d/fighterPose.test.ts`, `super-smash/src/render3d/fighter3d.ts`, `super-smash/src/render3d/fighter3d.test.ts`
- Modify: `super-smash/src/render/renderer.ts` (export `intangibleAlpha`)

**Interfaces:**
- Produces (`threeRig.ts`): `bindBones(rig3, model): (Object3D | null)[]`, `bonesFromRig(rig3): Bone[]`, `applyLocalPose(bones, pose)`, `applyRoot(group, root)`.
- Produces (`toon.ts`): `toonRamp()`, `RIM_ANCHOR`, `RIM_GLSL`, `ToonMaterial`, `toonMaterial(map, rimColor?, rimStrength?)`, `setHitFlash(material, amount)`.
- Produces (`fighterPose.ts`): `FighterPoseInputs { poser; samplers; def; bake }`, `poseInputs(poser, def, bake)`, `DrawnPose { index; sample; local; root }`, `bakedPoseAt(inputs, index)`, `drawnPose(inputs, f, frame, blends | null)`.
- Produces (`fighter3d.ts`): `FighterFrame { f; x; y; frame; blends; hitFlash; hidden }`, `Fighter3D { placement; kind; update(frame); bonePosition(name, out): boolean; dispose() }`, `Fighter3DOptions { def; port; poser; bake; model }`, `createFighter3D(opts)`, `simWorldX(f, localX)`.

- [ ] **Step 1: Write the failing tests** — `src/render3d/toon.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ShaderChunk, ShaderLib } from "three";

import { RIM_ANCHOR, setHitFlash, toonMaterial } from "./toon";

describe("the toon + rim material", () => {
  it("splices the rim into three's own toon shader (fails if a three upgrade moves the anchor)", () => {
    expect(ShaderLib.toon.fragmentShader).toContain(RIM_ANCHOR);
    // `vViewPosition` (the rim's view vector) is declared by a chunk the toon shader includes.
    expect(ShaderChunk.normal_fragment_begin).toContain("vViewPosition");
    const m = toonMaterial(null);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: ShaderLib.toon.fragmentShader, vertexShader: ShaderLib.toon.vertexShader };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain("rimStrength * pow(rimDot, 3.0)");
    expect(shader.fragmentShader.indexOf("uniform float rimStrength")).toBeLessThan(shader.fragmentShader.indexOf("void main()"));
    expect(shader.uniforms.rimStrength).toBe(m.userData.rimStrength);
  });

  it("cuts out alpha instead of sorting it, so eyes and hair cards never draw behind the face", () => {
    const m = toonMaterial(null);
    expect(m.alphaTest).toBe(0.5);
    expect(m.transparent).toBe(false);
  });

  it("flashes white through the emissive, never by compositing (D21)", () => {
    const m = toonMaterial(null);
    setHitFlash(m, 0.8);
    expect(m.emissive.r).toBeCloseTo(0.8, 6);
    expect(m.blending).toBe(1); // NormalBlending
  });
});
```

`src/render3d/fighterPose.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Group, Matrix4 } from "three";

import { BAKE_QUANTUM } from "@/engine/acmd/bakeCodec";
import { newBonePose } from "@/engine/acmd/bones";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fighterPoser } from "./bake/bake";
import { sideBonePose } from "./bake/fk";
import { poseIndexOf } from "@/engine/acmd/poseClock";
import { createVfx } from "@/render/vfx";
import { makeFighter } from "@/render/testFixtures";
import { bakedPoseAt, drawnPose, poseInputs } from "./fighterPose";
import { parseSkeletonFile } from "./skeleton/skeleton";
import { applyLocalPose, applyRoot, bonesFromRig } from "./threeRig";

const bake = readBakeFromDisk();

/**
 * The guarantee the whole plan rests on (spec §3.1, research R§2): what the
 * renderer draws on a frame is what the sim's bone table says for that frame.
 * three.js poses the bones here exactly as `Fighter3D` does, and every baked
 * bone of every frame of every motion must match the committed bake to within
 * its own quantum. The fighters are the game's (`withLimbScripts`): an adopted
 * limb-bone move plays its imported script's motion, and so must the drawing.
 */
describe("the renderer's pose equals the bake", () => {
  for (const def of FIGHTERS.map(withLimbScripts)) {
    it(`${def.id}: every baked bone, every frame, every motion`, () => {
      const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", `${def.id}.json`), "utf8")));
      const poser = fighterPoser(def, skeleton);
      const inputs = poseInputs(poser, def, bake);
      const root = new Group();
      const bones = bonesFromRig(poser.rig3);
      root.add(bones[0]);
      const baked = bake.bones;
      let checked = 0;
      for (const [motion, sampler] of inputs.samplers) {
        for (let k = 1; k <= sampler.clock.frames; k++) {
          const drawn = bakedPoseAt(inputs, { motion, frame: k });
          applyLocalPose(bones, drawn.local);
          applyRoot(root, drawn.root);
          root.updateMatrixWorld(true);
          for (const name of ["kneer", "arml", "head", "hip"]) {
            const i = poser.rig3.byLower.get(name);
            const want = newBonePose();
            if (i === undefined || !baked.pose(def.id, motion, k, name, want)) continue;
            const got = sideBonePose(new Matrix4().copy(bones[i].matrixWorld).toArray());
            for (const key of ["tx", "ty", "m00", "m01", "m02", "m10", "m11", "m12"] as const) {
              expect(Math.abs(got[key] - want[key]), `${motion}#${k} ${name}.${key}`).toBeLessThanOrEqual(BAKE_QUANTUM);
            }
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
    }, 60_000);
  }
});

describe("the drawn limbs follow the sim's clock, so they are where the hurtboxes are", () => {
  it("a fast-fall begun mid-descent is drawn on the frame the sim's hurtboxes use, once the fade is over", () => {
    const def = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!);
    const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "mario.json"), "utf8")));
    const inputs = poseInputs(fighterPoser(def, skeleton), def, bake);
    const blends = createVfx().poseBlend;
    let last = null as ReturnType<typeof drawnPose> | null;
    // Falling for 20 frames, then down is pressed: same action, new clip.
    for (let k = 0; k <= 32; k++) {
      const f = makeFighter({ action: "fall", grounded: false, actionFrame: k, fastFalling: k >= 20 });
      last = drawnPose(inputs, f, k, blends);
    }
    const f = makeFighter({ action: "fall", grounded: false, actionFrame: 32, fastFalling: true });
    expect(last!.index).toEqual(poseIndexOf(def, f, 32, bake.clock));
  });
});
```

`src/render3d/fighter3d.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { Group, Mesh, MeshBasicMaterial, Vector3 } from "three";

import { bonePoint, newBonePose } from "@/engine/acmd/bones";
import { poseIndexOf } from "@/engine/acmd/poseClock";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { fighterPoser } from "./bake/bake";
import { createFighter3D, simWorldX } from "./fighter3d";
import { parseSkeletonFile } from "./skeleton/skeleton";
import { bonesFromRig } from "./threeRig";

const bake = readBakeFromDisk();
/** The game's Mario: limb-bone scripts on, as the bake and the play page have him. */
const mario = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!);
const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "mario.json"), "utf8")));
const poser = fighterPoser(mario, skeleton);
const frameOf = (f: ReturnType<typeof makeFighter>) => ({ f, x: toFloat(f.x), y: toFloat(f.y), frame: 100, blends: null, hitFlash: 0, hidden: false });

describe("a fighter in the 3D scene", () => {
  it("puts a limb where the sim puts its hitbox, facing either way, legacy and adopted moves (Review Focus #4)", () => {
    // fsmash keeps its legacy script; uair runs its imported limb-bone script (limb.json).
    for (const [facing, move] of [[1, "fsmash"], [-1, "fsmash"], [1, "uair"], [-1, "uair"]] as const) {
      const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
      const f = makeFighter({ x: fx(20), y: fx(25), facing, grounded: move === "fsmash", action: "attack", move, actionFrame: move === "fsmash" ? 14 : 8 });
      fighter.update(frameOf(f));
      const at = poseIndexOf(mario, f, 100, bake.clock)!;
      for (const bone of ["arml", "kneer", "head"]) {
        const pose = newBonePose();
        expect(bake.bones.pose("mario", at.motion, at.frame, bone, pose)).toBe(true);
        const local = bonePoint(pose, 0, 0, 0);
        const p = new Vector3();
        expect(fighter.bonePosition(bone, p)).toBe(true);
        // Within the bake's quantum (1/256) plus float noise.
        expect(Math.abs(p.x - simWorldX(f, toFloat(local.x)))).toBeLessThan(0.01);
        expect(Math.abs(p.y - (toFloat(f.y) + toFloat(local.y)))).toBeLessThan(0.01);
      }
      fighter.dispose();
    }
  });

  it("hides a dead fighter, and one a move effect replaces", () => {
    const fighter = createFighter3D({ def: mario, port: 1, poser, bake, model: { kind: "standIn", reason: "test" } });
    fighter.update(frameOf(makeFighter({ action: "dead" })));
    expect(fighter.placement.visible).toBe(false);
    fighter.update({ ...frameOf(makeFighter()), hidden: true });
    expect(fighter.placement.visible).toBe(false);
    fighter.update(frameOf(makeFighter()));
    expect(fighter.placement.visible).toBe(true);
  });

  it("gives two players on the same model their own bones", () => {
    const scene = new Group();
    const bones = bonesFromRig(poser.rig3);
    scene.add(bones[0]);
    scene.add(new Mesh(undefined, new MeshBasicMaterial()));
    const a = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene } });
    const b = createFighter3D({ def: mario, port: 1, poser, bake, model: { kind: "glb", scene } });
    a.update(frameOf(makeFighter({ action: "attack", move: "fsmash", actionFrame: 14 })));
    b.update(frameOf(makeFighter({ action: "crouch", actionFrame: 9 })));
    const pa = new Vector3();
    const pb = new Vector3();
    a.bonePosition("arml", pa);
    b.bonePosition("arml", pb);
    expect(pa.distanceTo(pb)).toBeGreaterThan(0.5);
    // The shared source scene was never posed.
    expect(bones[0].position.toArray()).toEqual(poser.rig3.restLocalT[0]);
  });

  it("frees what it made, and only that", () => {
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    const disposed = vi.fn();
    fighter.placement.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).geometry.addEventListener("dispose", disposed);
    });
    fighter.dispose();
    expect(disposed).toHaveBeenCalledTimes(skeleton.hurt.length);
    expect(fighter.placement.children).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/render3d/toon.test.ts src/render3d/fighterPose.test.ts src/render3d/fighter3d.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./toon" from "src/render3d/toon.test.ts". Does the file exist?`, and the same for `"./fighterPose"` from `fighterPose.test.ts` and `"./fighter3d"` from `fighter3d.test.ts`.

- [ ] **Step 3: Implement** — in `src/render/renderer.ts` change `function intangibleAlpha(f: FighterState): number {` to `export function intangibleAlpha(f: FighterState): number {`.

`src/render3d/threeRig.ts`:

```ts
/**
 * The three.js side of a posed skeleton: find a model's bones by SSBU name,
 * write a `LocalPose` into them, and put the root transform on the group above.
 */

import { Bone, Matrix4, Object3D } from "three";

import { rootMatrix, type RootXform } from "./bake/fk";
import type { LocalPose } from "./retarget/retarget";
import type { Rig3 } from "./skeleton/skeleton";

/** The model's bone for each `Rig3` bone (by case-insensitive name), or null if absent. */
export function bindBones(rig: Rig3, model: Object3D): (Object3D | null)[] {
  const byLower = new Map<string, Object3D>();
  model.traverse((o) => {
    if ((o as Bone).isBone) byLower.set(o.name.toLowerCase(), o);
  });
  return rig.names.map((n) => byLower.get(n.toLowerCase()) ?? null);
}

/** A bare bone hierarchy for a `Rig3` — the stand-in's skeleton, and the test harness's. */
export function bonesFromRig(rig: Rig3): Bone[] {
  const bones = rig.names.map((name, i) => {
    const b = new Bone();
    b.name = name;
    b.position.set(...rig.restLocalT[i]);
    b.quaternion.set(...rig.restLocalQ[i]);
    return b;
  });
  rig.parent.forEach((p, i) => {
    if (p >= 0) bones[p].add(bones[i]);
  });
  return bones;
}

export function applyLocalPose(bones: readonly (Object3D | null)[], pose: LocalPose): void {
  bones.forEach((b, i) => {
    if (b === null) return;
    b.position.set(pose.t[i][0], pose.t[i][1], pose.t[i][2]);
    b.quaternion.set(pose.q[i][0], pose.q[i][1], pose.q[i][2], pose.q[i][3]);
  });
}

const scratch = new Matrix4();

/** The clip's offsets and squash, and the fighter's size, on the group that holds the model. */
export function applyRoot(group: Object3D, root: RootXform): void {
  group.matrixAutoUpdate = false;
  group.matrix.copy(scratch.fromArray(rootMatrix(root)));
  group.matrixWorldNeedsUpdate = true;
}
```

`src/render3d/toon.ts`:

```ts
/**
 * The fighters' material: Ultimate-ish cel shading — a three-step toon ramp on
 * the c00 colour texture plus a view-facing rim — in one `MeshToonMaterial`
 * per glb material, so a fighter costs one draw call per material and no extra
 * pass. `hitFlash` (D21's white flash on a hit victim) drives the emissive.
 */

import { Color, DataTexture, MeshToonMaterial, NearestFilter, RedFormat, type Texture } from "three";

/** Lit, mid, shadow — three bands, as Ultimate's toon ramp reads at a distance. UNVERIFIED: by eye. */
const RAMP = new Uint8Array([90, 170, 255]);

let ramp: DataTexture | null = null;
export function toonRamp(): DataTexture {
  if (ramp === null) {
    ramp = new DataTexture(RAMP, RAMP.length, 1, RedFormat);
    ramp.minFilter = NearestFilter;
    ramp.magFilter = NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

/** The anchor the rim is spliced after; `toon.test.ts` pins that three still has it. */
export const RIM_ANCHOR = "#include <emissivemap_fragment>";
export const RIM_GLSL = `
  float rimDot = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  totalEmissiveRadiance += rimColor * rimStrength * pow(rimDot, 3.0);
`;

export interface ToonMaterial extends MeshToonMaterial {
  userData: { rimStrength: { value: number }; hitFlash: number };
}

export function toonMaterial(map: Texture | null, rimColor = new Color(0xffffff), rimStrength = 0.35): ToonMaterial {
  const m = new MeshToonMaterial({ map, gradientMap: toonRamp(), alphaTest: 0.5 }) as ToonMaterial;
  const strength = { value: rimStrength };
  m.userData = { rimStrength: strength, hitFlash: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimStrength = strength;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec3 rimColor;\nuniform float rimStrength;\nvoid main() {")
      .replace(RIM_ANCHOR, `${RIM_ANCHOR}\n${RIM_GLSL}`);
  };
  m.customProgramCacheKey = () => "david-smash-toon-rim";
  return m;
}

/** White flash on a hit victim, 0..1 (`hitFlashAmount`). */
export function setHitFlash(m: ToonMaterial, amount: number): void {
  m.userData.hitFlash = amount;
  m.emissive.setScalar(amount);
}
```

`src/render3d/fighterPose.ts`:

```ts
/**
 * The pose the renderer draws for a fighter this frame — through the same
 * clock, samplers, retargeter and root transform the bake used, so the limb on
 * screen is the limb the sim's hitboxes and hurtboxes hang off (Plan 4).
 *
 * One deliberate difference, inherited from DECISIONS D42: a change of clip
 * fades over `BLEND_FRAMES` (`blend.ts`) except into an attack or an imposed
 * state. The sim has no fade, so during those four frames a hurtbox can lead the
 * drawn body slightly; hitboxes never can, because attacks never fade.
 */

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { poseIndexOf, type PoseIndex } from "@/engine/acmd/poseClock";
import type { FighterDef, FighterState } from "@/engine/types";
import { blendedPose, clipFrameFor, type PoseBlend } from "@/render/blend";
import type { PoseSample } from "@/render/poses/clip";
import { poseNameFor } from "@/render/poses/timing";
import { REST_SAMPLE } from "@/render/characterArt";
import { motionSamplers, rootXformOf, sampleAt, type FighterPoser, type MotionSampler } from "./bake/bake";
import type { RootXform } from "./bake/fk";
import { retarget, type LocalPose } from "./retarget/retarget";
import type { MotionKind } from "@/engine/acmd/types";

export interface FighterPoseInputs {
  readonly poser: FighterPoser;
  readonly samplers: ReadonlyMap<MotionKind, MotionSampler>;
  readonly def: FighterDef;
  readonly bake: BakeTables;
}

export function poseInputs(poser: FighterPoser, def: FighterDef, bake: BakeTables): FighterPoseInputs {
  return { poser, def, bake, samplers: motionSamplers(def) };
}

export interface DrawnPose {
  readonly index: PoseIndex | null;
  readonly sample: PoseSample;
  readonly local: LocalPose;
  readonly root: RootXform;
}

/** The unblended pose on a baked (motion, frame) — exactly what the bake stored. */
export function bakedPoseAt(p: FighterPoseInputs, index: PoseIndex): DrawnPose {
  const sampler = p.samplers.get(index.motion);
  const { sample, spin } = sampler ? sampleAt(sampler, index.frame) : { sample: REST_SAMPLE, spin: 0 };
  const spun = { ...sample, rotation: sample.rotation + spin };
  return {
    index,
    sample: spun,
    local: retarget(p.poser.cal, p.poser.rig2d, spun.angles, spun.rotation),
    root: rootXformOf(p.poser, spun),
  };
}

/** The pose a match draws for `f` on sim frame `frame`, faded per D42. */
export function drawnPose(
  p: FighterPoseInputs,
  f: FighterState,
  frame: number,
  blends: PoseBlend[] | null,
): DrawnPose {
  const name = poseNameFor(f);
  // Registers a change of clip so `blendedPose` fades it (D42), but its frame
  // is not used: the 2D renderer restarts a clip the action did not restart
  // (fast-falling twenty frames into a fall), while the sim's hurtboxes stay on
  // the action's clock. In 3D the limbs are the hurtboxes, so they follow the
  // sim's clock — the dive is entered where the sim has it, not at its frame 0.
  if (blends) clipFrameFor(blends, f, name, frame);
  const index = poseIndexOf(p.def, f, frame, p.bake.clock);
  const exact = index === null ? null : bakedPoseAt(p, index);
  const sample = exact?.sample ?? REST_SAMPLE;
  const shown = blends ? blendedPose(blends, f, name, sample, frame) : sample;
  return {
    index,
    sample: shown,
    local: retarget(p.poser.cal, p.poser.rig2d, shown.angles, shown.rotation),
    root: rootXformOf(p.poser, shown),
  };
}
```

`src/render3d/fighter3d.ts`:

```ts
/**
 * One fighter in the 3D scene: their SSBU model (or a stand-in), posed every
 * frame by `drawnPose`, turned to face the way they face, and flashed, blinked
 * or hidden the way the 2D figure was.
 *
 * Facing is a real turn (±90° about +Y), not a mirror: SSBU turns its fighters
 * round, so a left-facing Link holds his sword in the same hand. Every bone's
 * side-plane position is the same either way, so a hitbox the sim mirrors by
 * facing sits on the limb you see (`fighter3d.test.ts`, Review Focus #4).
 */

import {
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  type Material,
  type Object3D,
  type Texture,
  Vector3,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, FighterState } from "@/engine/types";
import type { PoseBlend } from "@/render/blend";
import { hitlagShake } from "@/render/characterArt";
import { intangibleAlpha } from "@/render/renderer";
import { PORT_COLOURS } from "@/render/rigKit";
import type { FighterPoser } from "./bake/bake";
import { drawnPose, poseInputs, type FighterPoseInputs } from "./fighterPose";
import type { LoadedModel } from "./models/loader";
import { applyLocalPose, applyRoot, bindBones, bonesFromRig } from "./threeRig";
import { setHitFlash, toonMaterial, type ToonMaterial } from "./toon";

export interface FighterFrame {
  readonly f: FighterState;
  /** Interpolated world position (`interpolatePosition`). */
  readonly x: number;
  readonly y: number;
  /** Sim frame, for the idle clock and the clip fade. */
  readonly frame: number;
  readonly blends: PoseBlend[] | null;
  readonly hitFlash: number;
  /** A move effect replaces the fighter this frame (Kirby's Stone). */
  readonly hidden: boolean;
}

export interface Fighter3D {
  /** Positioned and turned in world space; add it to the scene. */
  readonly placement: Group;
  readonly kind: LoadedModel["kind"];
  update(frame: FighterFrame): void;
  /** World position of a bone this frame (call after `update`); false if the rig lacks it. */
  bonePosition(name: string, out: Vector3): boolean;
  dispose(): void;
}

function standInModel(poser: FighterPoser, port: number): { root: Object3D; materials: ToonMaterial[] } {
  const bones = bonesFromRig(poser.rig3);
  const material = toonMaterial(null);
  material.color = new Color(PORT_COLOURS[port % PORT_COLOURS.length]);
  for (const h of poser.rig3.hurt) {
    const i = poser.rig3.byLower.get(h.bone.toLowerCase());
    if (i === undefined) continue;
    const length = Math.max(0.01, h.x2 - h.x1);
    const mesh = new Mesh(new CapsuleGeometry(h.r, length, 4, 8), material);
    // CapsuleGeometry runs along +Y; the hurt capsule runs along the bone's +X.
    mesh.rotation.z = -Math.PI / 2;
    mesh.position.x = (h.x1 + h.x2) / 2;
    mesh.frustumCulled = false;
    bones[i].add(mesh);
  }
  return { root: bones[0], materials: [material] };
}

function glbModel(scene: Object3D): { root: Object3D; materials: ToonMaterial[] } {
  const root = cloneSkinned(scene);
  const materials: ToonMaterial[] = [];
  const swapped = new Map<Material, ToonMaterial>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    // Skinned bounds are the bind pose's; a kick would cull its own foot.
    mesh.frustumCulled = false;
    const swap = (m: Material): ToonMaterial => {
      let t = swapped.get(m);
      if (t === undefined) {
        t = toonMaterial((m as Material & { map?: Texture | null }).map ?? null);
        t.name = m.name;
        swapped.set(m, t);
        materials.push(t);
      }
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  // The originals are the shared cache's; only our clones' replacements are ours to free.
  return { root, materials };
}

export interface Fighter3DOptions {
  readonly def: FighterDef;
  readonly port: number;
  readonly poser: FighterPoser;
  readonly bake: BakeTables;
  readonly model: LoadedModel;
}

export function createFighter3D(opts: Fighter3DOptions): Fighter3D {
  const { poser } = opts;
  const inputs: FighterPoseInputs = poseInputs(poser, opts.def, opts.bake);
  const built = opts.model.kind === "glb" ? glbModel(opts.model.scene) : standInModel(poser, opts.port);
  const rootGroup = new Group();
  rootGroup.add(built.root);
  const placement = new Group();
  placement.name = `fighter:${opts.port}:${opts.def.id}`;
  placement.add(rootGroup);
  const bones = bindBones(poser.rig3, built.root);
  let opacity = 1;

  return {
    placement,
    kind: opts.model.kind,
    update(fr) {
      const f = fr.f;
      placement.visible = f.action !== "dead" && !fr.hidden;
      if (!placement.visible) return;
      placement.position.set(fr.x + hitlagShake(f), fr.y, 0);
      placement.rotation.set(0, f.facing >= 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      const pose = drawnPose(inputs, f, fr.frame, fr.blends);
      applyLocalPose(bones, pose.local);
      applyRoot(rootGroup, pose.root);
      const alpha = intangibleAlpha(f);
      for (const m of built.materials) {
        setHitFlash(m, fr.hitFlash);
        if (alpha !== opacity) {
          m.transparent = alpha < 1;
          m.opacity = alpha;
          m.needsUpdate = true;
        }
      }
      opacity = alpha;
      placement.updateMatrixWorld(true);
    },
    bonePosition(name, out) {
      const i = poser.rig3.byLower.get(name.toLowerCase());
      const b = i === undefined ? null : bones[i];
      if (b === null || b === undefined) return false;
      b.getWorldPosition(out);
      return true;
    },
    dispose() {
      placement.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && opts.model.kind === "standIn") mesh.geometry.dispose();
      });
      for (const m of built.materials) m.dispose();
      placement.clear();
    },
  };
}

/** Where a fighter's facing-relative point is in the world — the sim's own mirror rule. */
export function simWorldX(f: Pick<FighterState, "x" | "facing">, localX: number): number {
  return toFloat(f.x) + (f.facing >= 0 ? localX : -localX);
}
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/render3d/toon.test.ts src/render3d/fighterPose.test.ts src/render3d/fighter3d.test.ts`
Expected: PASS (toon 3, fighterPose 9 — one per fighter, each checking well over 1,000 bone-frames, plus the fast-fall clock — and fighter3d 4). Indexing by `clipFrameFor`'s frame instead fails the fast-fall test with `expected { motion: 'status_fall_fast', …(1) } to deeply equal { motion: 'status_fall_fast', …(1) }` (frame 13 drawn, 30 in the sim); baking or drawing the legacy fighters instead of `withLimbScripts` fails Mario's motions (`attack_air_hi#2 kneer.tx: expected 544 to be less than or equal to 16`). To see `fighterPose.test.ts` bite on the root transform, change `applyRoot`'s `rootMatrix(root)` to `rootMatrix({ ...root, scale: 1 })` and watch Fox (scale 1.08) fail, then restore.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render3d/threeRig.ts super-smash/src/render3d/toon.ts super-smash/src/render3d/toon.test.ts super-smash/src/render3d/fighterPose.ts super-smash/src/render3d/fighterPose.test.ts super-smash/src/render3d/fighter3d.ts super-smash/src/render3d/fighter3d.test.ts super-smash/src/render/renderer.ts
git commit -m "super-smash: fighters in 3D, posed exactly as the bake" -m "The renderer runs the bake's own clock, sampler, retargeter and root transform on the game's fighters and writes the pose into the model's bones; a test checks every baked bone of every frame of every motion against the committed bake, and that a mid-fall fast fall is drawn on the sim's frame. Facing turns the model (as SSBU) and the mirrored hitbox stays on the drawn limb; toon + rim material, D21 flash via emissive, intangibility blink." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Sparks, KO blasts and shields as instanced 3D effects

Two draw calls whatever is on screen: one `InstancedMesh` of quads for every hit spark and burst in `VfxState.particles` (a KO's blast is a burst, `ingestEvents`), one of spheres for up to four shields. Every other particle kind (dust, rings, smoke, motes, stars, clanks) stays on the 2D overlay. Shapes and timings are D36's (a spark a third of a fighter, gone in a tenth of a second); only the drawing moved. The shield bubble is the sim's own (`shieldBubble(f, def)`, Plan 3: `shield_radius` × `scale` × `shieldScale(health)`), so what blocks is what you see, white while a perfect shield flashes — D43's "the shield does not know its own health", closed.

**Files:**
- Create: `super-smash/src/render3d/vfx3d.ts`, `super-smash/src/render3d/vfx3d.test.ts`

**Interfaces:**
- Consumes: `shieldBubble` (Plan 3 `src/engine/shield.ts`).
- Produces: `SPRITE_KINDS` (`spark`, `burst`), `MAX_SPRITES = 640`, `MAX_SHIELDS = 4`, `SPRITE_Z = 4`, `ShieldLook { x; y; radius; alpha; colour }`, `shieldLook(f, def, parryFlash): ShieldLook | null`, `Vfx3D { group; update(v, shields); counts(); dispose() }`, `createVfx3D()`.

- [ ] **Step 1: Write the failing test** — `src/render3d/vfx3d.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { SHIELD_MAX_HEALTH } from "@/engine/constants";
import type { StepEvents } from "@/engine/types";
import { makeEvents, makeFighter, makeState } from "@/render/testFixtures";
import { createVfx, ingestEvents, spawnDust } from "@/render/vfx";
import { fx, toFloat } from "@/engine/fixed";
import { shieldBubble } from "@/engine/shield";
import { FIGHTERS } from "@/fighters";
import { MAX_SPRITES, createVfx3D, shieldLook } from "./vfx3d";

describe("the shield bubble is the sim's own", () => {
  const mario = FIGHTERS.find((f) => f.id === "mario")!;

  it("sits and shrinks exactly as shieldBubble says, with health", () => {
    for (const hp of [SHIELD_MAX_HEALTH, SHIELD_MAX_HEALTH / 2, 0]) {
      const f = makeFighter({ action: "shield", shieldHealth: hp, x: fx(10), y: fx(2) });
      const look = shieldLook(f, mario, 0)!;
      const sim = shieldBubble(f, mario);
      expect(look.radius).toBeCloseTo(toFloat(sim.r), 9);
      expect(look.x).toBeCloseTo(toFloat(sim.x1), 9);
      expect(look.y).toBeCloseTo(toFloat(sim.y1), 9);
    }
    const full = shieldLook(makeFighter({ action: "shield", shieldHealth: SHIELD_MAX_HEALTH }), mario, 0)!;
    const low = shieldLook(makeFighter({ action: "shield", shieldHealth: SHIELD_MAX_HEALTH / 5 }), mario, 0)!;
    expect(low.radius).toBeLessThan(full.radius);
  });

  it("is absent unless the fighter is shielding, and flashes white on a perfect shield", () => {
    expect(shieldLook(makeFighter({ action: "stand" }), mario, 0)).toBeNull();
    expect(shieldLook(makeFighter({ action: "shieldRelease", actionFrame: 1 }), mario, 6)!.colour).toBe("#FFFFFF");
  });
});

describe("3D sparks, KO blasts and shields as instances", () => {
  const hit = (n: number): StepEvents =>
    makeEvents({
      hits: Array.from({ length: n }, () => ({ attacker: 0, victim: 1, damage: 4096 * 12, x: 0, y: 4096 * 6, knockback: 4096 * 80, angle: 45, hitboxId: 0 })),
    } as Partial<StepEvents>);

  it("draws a hit's sparks and burst, and leaves dust to the 2D overlay", () => {
    const v = createVfx();
    const state = makeState();
    ingestEvents(v, hit(1), state);
    spawnDust(v, 0, 0, 1, 6);
    const fx = createVfx3D();
    fx.update(v, []);
    const kinds = new Set(v.particles.map((p) => p.kind));
    expect(kinds.has("dust")).toBe(true);
    expect(fx.counts().sprites).toBe(v.particles.filter((p) => p.kind === "spark" || p.kind === "burst").length);
    expect(fx.counts().sprites).toBeGreaterThan(0);
  });

  it("never draws more instances than it allocated, however busy the screen", () => {
    // The 2D pool caps itself at the same 640, so flooding it through
    // ingestEvents can never exceed MAX_SPRITES; hand the layer more than that.
    const v = createVfx();
    ingestEvents(v, hit(1), makeState());
    const spark = v.particles.find((p) => p.kind === "spark")!;
    v.particles.length = 0;
    for (let i = 0; i < MAX_SPRITES + 50; i++) v.particles.push({ ...spark });
    const fx = createVfx3D();
    fx.update(v, []);
    expect(fx.counts().sprites).toBe(MAX_SPRITES);
  });

  it("places one bubble per shielding fighter", () => {
    const layer = createVfx3D();
    const mario = FIGHTERS.find((f) => f.id === "mario")!;
    layer.update(createVfx(), [shieldLook(makeFighter({ action: "shield" }), mario, 0), null]);
    expect(layer.counts().shields).toBe(1);
  });

  it("frees its buffers, materials and texture on dispose", () => {
    const fx = createVfx3D();
    const geometries = vi.fn();
    const materials = vi.fn();
    const textures = vi.fn();
    type Disposable = { addEventListener(t: string, f: () => void): void };
    fx.group.traverse((o) => {
      const { geometry, material } = o as { geometry?: Disposable; material?: Disposable & { map?: Disposable | null } };
      geometry?.addEventListener("dispose", geometries);
      material?.addEventListener("dispose", materials);
      material?.map?.addEventListener("dispose", textures);
    });
    fx.dispose();
    expect(geometries).toHaveBeenCalledTimes(2);
    expect(materials).toHaveBeenCalledTimes(2);
    expect(textures).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/vfx3d.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./vfx3d" from "src/render3d/vfx3d.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/render3d/vfx3d.ts`:

```ts
/**
 * The 3D effects: hit sparks and KO blasts as instanced sprites, and the
 * shield bubble as an instanced sphere — the sim's own bubble, health and all.
 *
 * Two draw calls whatever is happening on screen — one InstancedMesh of quads
 * for every spark and burst in `VfxState.particles`, one of spheres for up to
 * four shields — which is what keeps a four-player pile-up inside the R§4
 * budget. Every other particle kind (dust, rings, smoke, motes) stays on the 2D
 * overlay, drawn by `drawParticles` with the 3D kinds excluded.
 *
 * Shapes and timings are the 2D ones (D36: a spark is a third of a fighter and
 * gone in a tenth of a second); only the drawing moved.
 */

import {
  AdditiveBlending,
  Color,
  DataTexture,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SphereGeometry,
  Vector3,
} from "three";

import { SHIELD_RELEASE_FRAMES } from "@/engine/constants";
import { toFloat } from "@/engine/fixed";
import { shieldBubble } from "@/engine/shield";
import type { FighterDef, FighterState } from "@/engine/types";
import { PORT_COLOURS } from "@/render/rigKit";
import { BURST_MAX_GROWTH, type ParticleKind, type VfxState } from "@/render/vfx";

/** Particle kinds the 3D layer draws; `drawParticles` skips them in 3D mode. */
export const SPRITE_KINDS: ReadonlySet<ParticleKind> = new Set<ParticleKind>(["spark", "burst"]);
export const MAX_SPRITES = 640;
export const MAX_SHIELDS = 4;
/** Sprites sit just in front of the fighters' plane so a spark lands on the victim. */
export const SPRITE_Z = 4;

/* ------------------------------------------------------------- shield -- */

export interface ShieldLook {
  /** World units: the sim's own bubble (`shieldBubble`, Plan 3). */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
  readonly colour: string;
}

function shielding(f: Pick<FighterState, "action">): boolean {
  return f.action === "shieldStart" || f.action === "shield" || f.action === "shieldStun" || f.action === "shieldRelease";
}

/**
 * The bubble a shielding fighter shows: exactly the sim's `shieldBubble` — its
 * centre and its health-scaled radius — so what blocks is what you see, fading
 * in on raise and out on release, white while a perfect shield flashes. Null
 * when not shielding.
 */
export function shieldLook(
  f: Pick<FighterState, "action" | "actionFrame" | "shieldHealth" | "port" | "x" | "y">,
  def: FighterDef,
  parryFlash: number,
): ShieldLook | null {
  if (!shielding(f)) return null;
  const c = shieldBubble(f, def);
  const at = { x: toFloat(c.x1), y: toFloat(c.y1), radius: toFloat(c.r) };
  if (parryFlash > 0) return { ...at, alpha: 0.35 + (parryFlash / 10) * 0.6, colour: "#FFFFFF" };
  let alpha = 0.42;
  if (f.action === "shieldStart") alpha *= Math.min(1, f.actionFrame / 3 + 0.35);
  if (f.action === "shieldRelease") alpha *= Math.max(0, 1 - f.actionFrame / SHIELD_RELEASE_FRAMES);
  return { ...at, alpha, colour: PORT_COLOURS[f.port % PORT_COLOURS.length] };
}

/* ------------------------------------------------------------ sprites -- */

/** A soft four-point star, generated — no texture file to fetch. */
function starTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const r = Math.hypot(u, v) * 2;
      const arms = Math.min(Math.abs(u), Math.abs(v)) * 6;
      const a = Math.max(0, 1 - r) ** 1.5 * Math.max(0, 1 - arms) + Math.max(0, 1 - r * 2.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface Vfx3D {
  readonly group: Group;
  /** `shields[port]`: that fighter's bubble this frame, or null. */
  update(v: VfxState, shields: readonly (ShieldLook | null)[]): void;
  /** Instances drawn last update, for tests and `__smashRender.info()`. */
  counts(): { sprites: number; shields: number };
  dispose(): void;
}

export function createVfx3D(): Vfx3D {
  const group = new Group();
  group.name = "vfx";
  const texture = starTexture();
  const spriteMaterial = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const sprites = new InstancedMesh(new PlaneGeometry(1, 1), spriteMaterial, MAX_SPRITES);
  sprites.instanceMatrix.setUsage(DynamicDrawUsage);
  sprites.frustumCulled = false;
  const shieldMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const bubbles = new InstancedMesh(new SphereGeometry(1, 24, 16), shieldMaterial, MAX_SHIELDS);
  bubbles.frustumCulled = false;
  group.add(sprites, bubbles);

  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const c = new Color();
  let spriteCount = 0;
  let shieldCount = 0;

  return {
    group,
    update(v, shields) {
      spriteCount = 0;
      for (const part of v.particles) {
        if (!SPRITE_KINDS.has(part.kind) || spriteCount >= MAX_SPRITES) continue;
        const t = part.life / part.maxLife;
        if (part.kind === "spark") {
          // A streak stretched back along its own velocity (D36).
          const speed = Math.hypot(part.vx, part.vy);
          const trail = Math.min(30 / 6, speed * 2.2);
          q.setFromAxisAngle(zAxis, Math.atan2(part.vy, part.vx));
          s.set(Math.max(part.size, trail), Math.max(0.15, part.size * 0.7), 1);
          p.set(part.x - (Math.cos(Math.atan2(part.vy, part.vx)) * trail) / 2, part.y - (Math.sin(Math.atan2(part.vy, part.vx)) * trail) / 2, SPRITE_Z);
        } else {
          const grow = 1 + (1 - t) * (BURST_MAX_GROWTH - 1);
          q.setFromAxisAngle(zAxis, part.rotation);
          s.setScalar(part.size * grow * 2);
          p.set(part.x, part.y, SPRITE_Z);
        }
        m.compose(p, q, s);
        sprites.setMatrixAt(spriteCount, m);
        // Additive: fading the colour fades the sprite.
        sprites.setColorAt(spriteCount, c.set(part.colour).multiplyScalar(Math.min(1, t * 1.8)));
        spriteCount++;
      }
      sprites.count = spriteCount;
      sprites.instanceMatrix.needsUpdate = true;
      if (sprites.instanceColor) sprites.instanceColor.needsUpdate = true;

      shieldCount = 0;
      for (const sh of shields) {
        if (sh === null || shieldCount >= MAX_SHIELDS) continue;
        m.compose(p.set(sh.x, sh.y, 0), q.identity(), s.setScalar(sh.radius));
        bubbles.setMatrixAt(shieldCount, m);
        bubbles.setColorAt(shieldCount, c.set(sh.colour).multiplyScalar(sh.alpha));
        shieldCount++;
      }
      bubbles.count = shieldCount;
      bubbles.instanceMatrix.needsUpdate = true;
      if (bubbles.instanceColor) bubbles.instanceColor.needsUpdate = true;
    },
    counts: () => ({ sprites: spriteCount, shields: shieldCount }),
    dispose() {
      sprites.geometry.dispose();
      bubbles.geometry.dispose();
      spriteMaterial.dispose();
      shieldMaterial.dispose();
      texture.dispose();
      sprites.dispose();
      bubbles.dispose();
      group.clear();
    },
  };
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render3d/vfx3d.test.ts`
Expected: PASS (6 tests). Both resource tests can fail: the cap test hands the layer `MAX_SPRITES + 50` sparks directly (the 2D pool caps itself at the same 640, so flooding it through `ingestEvents` never could) and removing the cap check fails it with `expected 690 to be 640`; the dispose test listens on the star texture too, and dropping `texture.dispose()` fails it with `expected "vi.fn()" to be called 1 times, but got 0 times`.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render3d/vfx3d.ts super-smash/src/render3d/vfx3d.test.ts
git commit -m "super-smash: hit sparks, KO blasts and shield bubbles as instanced 3D effects" -m "Two draw calls however busy the screen; sparks keep D36's size and timing; the bubble is the sim's own shieldBubble, health and all." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: The 3D presenter — scene, lights, blob shadows, context loss, resize, dispose

One `WebGLRenderer` (antialias, transparent clear, `powerPreference: "high-performance"`) draws the stage, the fighters, their blob shadows (one instanced disc per grounded fighter — one draw call; shadow maps would double every fighter's draw calls and break the budget) and the effects, with a hemisphere + ambient + directional light and no bloom (decided, "Decisions taken" 7). The drawing buffer follows the canvas's CSS size × device pixel ratio, capped at the game's 1920×1080 and kept 16:9 so it matches the overlay. A lost context pauses painting (`preventDefault` so the browser offers it back) while the sim keeps running; on restore every material recompiles. Models that fail become stand-ins (Task 16). `dispose()` frees every geometry, material, texture and the GL context, idempotently, and removes its listeners.

**Files:**
- Create: `super-smash/src/render3d/renderer3d.ts`, `super-smash/src/render3d/renderer3d.test.ts`

**Interfaces:**
- Consumes: `RenderState`, `interpolatePosition` (`render/renderer.ts`), `hitFlashAmount` (`render/vfx.ts`), `fighterParams` (`params.ts`), `SKELETONS` (Task 6), `MAX_DRAW_CALLS`/`MAX_FIGHTER_PRIMITIVES` (Task 8), Tasks 14–18.
- Produces: `GLLike` (the slice of `WebGLRenderer` used; a fake in tests), `RenderInfo { calls; triangles; lost; buffer; fighters }`, `Presenter3D { ready: Promise<void>; paint(rs, camera, alpha, hidden); resize(cssW, cssH, dpr); info(); dispose() }`, `Renderer3DOptions { canvas; stage; defs; bake; skeletons; models; makeGL? }`, `bufferSizeFor(cssW, cssH, dpr)`, `createRenderer3D(opts)`.

- [ ] **Step 1: Write the failing test** — `src/render3d/renderer3d.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Group, Mesh, MeshBasicMaterial, type Object3D } from "three";

import { createInitialState } from "@/engine/simulate";
import type { GameState } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { bootstrapEngine } from "@/game/bootstrap";
import { readBakeFromDisk } from "@/game/bakeNode";
import { createCamera } from "@/render/camera";
import { createHudState } from "@/render/hud";
import type { RenderState } from "@/render/renderer";
import { createVfx } from "@/render/vfx";
import { STAGES } from "@/stages";
import { fighterPoser } from "./bake/bake";
import { MAX_DRAW_CALLS, MAX_FIGHTER_PRIMITIVES } from "./budget";
import { createModelCache, parseModelIndex, type ModelCache, type ModelIndexEntry } from "./models/loader";
import { bufferSizeFor, createRenderer3D, type GLLike } from "./renderer3d";
import { SKELETONS } from "./skeletons";
import { bonesFromRig } from "./threeRig";

const bake = readBakeFromDisk();
const stage = STAGES.find((s) => s.id === "battlefield")!;
const defs = ["mario", "fox", "kirby", "donkeyKong"].map((id) => withLimbScripts(FIGHTERS.find((f) => f.id === id)!));

function fakeGL(canvas: HTMLCanvasElement) {
  const gl = {
    domElement: canvas,
    info: { render: { calls: 0, triangles: 0 } },
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    render: vi.fn((scene: Object3D) => {
      let calls = 0;
      scene.traverseVisible((o) => {
        if ((o as { isMesh?: boolean }).isMesh) calls += 1;
      });
      gl.info.render.calls = calls;
    }),
    dispose: vi.fn(),
  };
  return gl satisfies GLLike;
}

/** A glb as `pnpm models` builds it at its worst: the fighter's bones and MAX_FIGHTER_PRIMITIVES primitives. */
function glbAtTheCap(entry: ModelIndexEntry): Object3D {
  const def = defs.find((d) => entry.file.startsWith(`${d.id}.`))!;
  const scene = new Group();
  scene.add(bonesFromRig(fighterPoser(def, SKELETONS[def.id]).rig3)[0]);
  for (let i = 0; i < MAX_FIGHTER_PRIMITIVES; i++) scene.add(new Mesh(undefined, new MeshBasicMaterial()));
  return scene;
}

function setup(models?: ModelCache) {
  bootstrapEngine();
  const canvas = document.createElement("canvas");
  let gl!: ReturnType<typeof fakeGL>;
  const warn = vi.fn();
  const presenter = createRenderer3D({
    canvas,
    stage,
    defs,
    bake,
    skeletons: SKELETONS,
    // By default no `pnpm models`: every fighter must come out as a stand-in, and the match must still paint.
    models: models ?? createModelCache({ index: async () => null, load: async () => { throw new Error("unreachable"); } }, warn),
    makeGL: (c) => (gl = fakeGL(c)),
  });
  const state: GameState = createInitialState(stage.id, defs.map((d) => ({ defId: d.id })), { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false }, 1);
  const rs: RenderState = { current: state, previous: null, stage, fighters: defs, vfx: createVfx(), hud: createHudState() };
  return { canvas, gl: () => gl, presenter, rs, warn };
}

describe("the 3D presenter", () => {
  it("paints four stand-in fighters when no models were built (Review Focus #1), inside the draw-call budget", async () => {
    const { presenter, rs, gl, warn } = setup();
    await presenter.ready;
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).toHaveBeenCalledOnce();
    expect(presenter.info().fighters).toEqual(["standIn", "standIn", "standIn", "standIn"]);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(presenter.info().calls).toBeLessThan(100);
  });

  it("stays inside the draw-call budget with four real models at the glb.mjs primitive cap (MAJOR 3)", async () => {
    const index = parseModelIndex({ schema: 1, models: Object.fromEntries(defs.map((d) => [d.id, { file: `${d.id}.00000000.glb`, bytes: 1, sha256: "x" }])) });
    const { presenter, rs } = setup(createModelCache({ index: async () => index, load: async (e) => glbAtTheCap(e) }, vi.fn()));
    await presenter.ready;
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(presenter.info().fighters).toEqual(["glb", "glb", "glb", "glb"]);
    expect(presenter.info().calls).toBeGreaterThanOrEqual(4 * MAX_FIGHTER_PRIMITIVES);
    expect(presenter.info().calls).toBeLessThan(MAX_DRAW_CALLS);
  });

  it("stops painting while the WebGL context is lost and resumes when it is restored (Review Focus #2)", async () => {
    const { presenter, rs, gl, canvas } = setup();
    await presenter.ready;
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).not.toHaveBeenCalled();
    expect(presenter.info().lost).toBe(true);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).toHaveBeenCalledOnce();
  });

  it("sizes its buffer to the window and the display's pixel ratio, never past 1080p (Review Focus #3)", () => {
    expect(bufferSizeFor(1280, 720, 1)).toEqual({ width: 1280, height: 720 });
    expect(bufferSizeFor(1280, 720, 2)).toEqual({ width: 1920, height: 1080 });
    expect(bufferSizeFor(1000, 900, 1)).toEqual({ width: 1000, height: 563 });
    expect(bufferSizeFor(100, 50, 1)).toEqual({ width: 320, height: 180 });
    const { presenter, gl } = setup();
    presenter.resize(1280, 720, 1);
    expect(gl().setSize).toHaveBeenLastCalledWith(1280, 720, false);
    presenter.resize(1280, 720, 2);
    expect(gl().setSize).toHaveBeenLastCalledWith(1920, 1080, false);
    expect(presenter.info().buffer).toEqual({ width: 1920, height: 1080 });
  });

  it("frees the GL renderer and stops listening on dispose, and paints nothing afterwards", async () => {
    const { presenter, rs, gl, canvas } = setup();
    await presenter.ready;
    const remove = vi.spyOn(canvas, "removeEventListener");
    presenter.dispose();
    expect(gl().dispose).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("webglcontextlost", expect.any(Function), false);
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).not.toHaveBeenCalled();
    presenter.dispose();
    expect(gl().dispose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/render3d/renderer3d.test.ts`
Expected: FAIL — `Error: Failed to resolve import "./renderer3d" from "src/render3d/renderer3d.test.ts". Does the file exist?`

- [ ] **Step 3: Implement** — `src/render3d/renderer3d.ts`:

```ts
/**
 * The 3D presenter: owns the WebGL canvas, the scene (stage, fighters, effects,
 * blob shadows, lights) and its camera, and paints one frame when the match
 * runner asks. The HUD and every 2D effect stay on the overlay canvas above it
 * (`render/renderer.ts` with `world3d`), framed by the same `Camera`, so the two
 * layers line up exactly (`camera3d.ts`).
 *
 * It never takes the match down: missing glbs become stand-ins (`models/`), a
 * lost WebGL context pauses painting until the browser restores it (the sim
 * keeps running), and `dispose()` frees every GPU resource it made when the
 * match ends (`MatchRunner.dispose`).
 */

import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  type Camera as ThreeCamera,
  type Object3D,
} from "three";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, StageDef } from "@/engine/types";
import { VIEW_HEIGHT, VIEW_WIDTH, type Camera } from "@/render/camera";
import { interpolatePosition, type RenderState } from "@/render/renderer";
import { hitFlashAmount } from "@/render/vfx";
import { fighterPoser } from "./bake/bake";
import { applySideCamera, createSideCamera } from "./camera3d";
import { createFighter3D, type Fighter3D } from "./fighter3d";
import type { ModelCache } from "./models/loader";
import type { SkeletonFile } from "./skeleton/skeleton";
import { createStage3D, type Stage3D } from "./stage3d";
import { createVfx3D, shieldLook, type ShieldLook, type Vfx3D } from "./vfx3d";

/** The part of `WebGLRenderer` the presenter uses — a fake in jsdom tests. */
export interface GLLike {
  readonly domElement: HTMLCanvasElement;
  readonly info: { readonly render: { readonly calls: number; readonly triangles: number } };
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle: boolean): void;
  setClearColor(colour: number, alpha: number): void;
  render(scene: Object3D, camera: ThreeCamera): void;
  dispose(): void;
}

export interface RenderInfo {
  readonly calls: number;
  readonly triangles: number;
  readonly lost: boolean;
  readonly buffer: { readonly width: number; readonly height: number };
  readonly fighters: readonly ("glb" | "standIn" | "loading")[];
}

export interface Presenter3D {
  /** Resolves when every fighter has a model (or a stand-in). */
  readonly ready: Promise<void>;
  /** `hidden[port]`: a move effect replaces that fighter this frame. */
  paint(rs: RenderState, camera: Camera, alpha: number, hidden: readonly boolean[]): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  info(): RenderInfo;
  dispose(): void;
}

export interface Renderer3DOptions {
  readonly canvas: HTMLCanvasElement;
  readonly stage: StageDef;
  readonly defs: readonly (FighterDef | null)[];
  readonly bake: BakeTables;
  readonly skeletons: Readonly<Record<string, SkeletonFile>>;
  readonly models: ModelCache;
  readonly makeGL?: (canvas: HTMLCanvasElement) => GLLike;
}

/**
 * The drawing buffer for a canvas shown at `css` pixels on a `dpr` display:
 * device pixels, capped at the game's 1920×1080 internal resolution (the R§4
 * budget is 1080p) and kept 16:9 so it matches the overlay canvas exactly.
 */
export function bufferSizeFor(cssWidth: number, cssHeight: number, dpr: number): { width: number; height: number } {
  const fit = Math.min(cssWidth, (cssHeight * VIEW_WIDTH) / VIEW_HEIGHT) * Math.max(0.5, dpr || 1);
  const width = Math.round(Math.max(320, Math.min(VIEW_WIDTH, fit)));
  return { width, height: Math.round((width * VIEW_HEIGHT) / VIEW_WIDTH) };
}

function defaultGL(canvas: HTMLCanvasElement): GLLike {
  return new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
}

export function createRenderer3D(opts: Renderer3DOptions): Presenter3D {
  const gl = (opts.makeGL ?? defaultGL)(opts.canvas);
  gl.setClearColor(0x000000, 0);
  let buffer = bufferSizeFor(VIEW_WIDTH, VIEW_HEIGHT, 1);
  gl.setPixelRatio(1);
  gl.setSize(buffer.width, buffer.height, false);

  const scene = new Scene();
  const camera = createSideCamera();
  scene.add(new HemisphereLight(0xffffff, 0x445066, 1.4), new AmbientLight(0xffffff, 0.25));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-40, 120, 160);
  scene.add(sun);

  const stage: Stage3D = createStage3D(opts.stage);
  scene.add(stage.group);
  const vfx: Vfx3D = createVfx3D();
  scene.add(vfx.group);

  // Blob shadows: one instanced disc per grounded fighter, one draw call.
  const shadowGeometry = new CircleGeometry(1, 24);
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new MeshBasicMaterial({ color: new Color(0x000000), transparent: true, opacity: 0.35, depthWrite: false });
  const shadows = new InstancedMesh(shadowGeometry, shadowMaterial, 4);
  shadows.frustumCulled = false;
  scene.add(shadows);

  const fighters: (Fighter3D | null)[] = opts.defs.map(() => null);
  const fighterGroup = new Group();
  scene.add(fighterGroup);
  let disposed = false;

  const ready = Promise.all(
    opts.defs.map(async (def, port) => {
      if (def === null) return;
      const skeleton = opts.skeletons[def.id];
      if (skeleton === undefined) throw new Error(`no skeleton for ${def.id}`);
      const model = await opts.models.get(def.id);
      if (disposed) return;
      const fighter = createFighter3D({ def, port, poser: fighterPoser(def, skeleton), bake: opts.bake, model });
      fighters[port] = fighter;
      fighterGroup.add(fighter.placement);
    }),
  ).then(() => undefined);

  let lost = false;
  const onLost = (e: Event) => {
    // Without preventDefault the browser never offers the context back.
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
    // three re-initialises its GL state on restore; materials recompile on next use.
    scene.traverse((o) => {
      const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.needsUpdate = true;
    });
  };
  opts.canvas.addEventListener("webglcontextlost", onLost, false);
  opts.canvas.addEventListener("webglcontextrestored", onRestored, false);

  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();

  return {
    ready,
    paint(rs, cam, alpha, hidden) {
      if (disposed || lost) return;
      const game = rs.current;
      stage.update(game.frame);
      applySideCamera(camera, cam);

      const bubbles: (ShieldLook | null)[] = [];
      let shadowCount = 0;
      for (const f of game.fighters) {
        const fighter = fighters[f.port] ?? null;
        const def = rs.fighters[f.port] ?? null;
        if (fighter === null || def === null) {
          bubbles.push(null);
          continue;
        }
        const previous = rs.previous?.fighters.find((o) => o.port === f.port);
        const pos = interpolatePosition(previous, f, alpha);
        fighter.update({
          f,
          x: pos.x,
          y: pos.y,
          frame: game.frame,
          blends: rs.vfx.poseBlend,
          hitFlash: hitFlashAmount(rs.vfx, f.port),
          hidden: hidden[f.port] ?? false,
        });
        bubbles.push(shieldLook(f, def, rs.vfx.parryFlash[f.port] ?? 0));
        if (f.grounded && f.action !== "dead" && shadowCount < 4) {
          m.compose(p.set(pos.x, pos.y + 0.05, 0), q.identity(), s.set(toFloat(def.attributes.width) * 1.6, 1, toFloat(def.attributes.width) * 1.1));
          shadows.setMatrixAt(shadowCount++, m);
        }
      }
      shadows.count = shadowCount;
      shadows.instanceMatrix.needsUpdate = true;
      vfx.update(rs.vfx, bubbles);
      gl.render(scene, camera);
    },
    resize(cssWidth, cssHeight, dpr) {
      const next = bufferSizeFor(cssWidth, cssHeight, dpr);
      if (next.width === buffer.width && next.height === buffer.height) return;
      buffer = next;
      gl.setSize(buffer.width, buffer.height, false);
    },
    info() {
      return {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        lost,
        buffer,
        fighters: opts.defs.map((d) => (d === null ? "loading" : (opts.models.status()[d.id] ?? "loading"))),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      opts.canvas.removeEventListener("webglcontextlost", onLost, false);
      opts.canvas.removeEventListener("webglcontextrestored", onRestored, false);
      for (const f of fighters) f?.dispose();
      stage.dispose();
      vfx.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      shadows.dispose();
      scene.clear();
      gl.dispose();
    },
  };
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render3d/renderer3d.test.ts`
Expected: PASS (5 tests). "stays inside the draw-call budget with four real models at the glb.mjs primitive cap" gives each of the four fighters a scene of 12 meshes on its own bones — the worst `glb.mjs` lets through — and counts 55 calls (48 fighters, the stage's platforms, two effect batches, the shadows) against 100. The stand-in match measured 50 draw calls and 7,200 triangles in a real browser (Task 22 checks the real glbs).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render3d/renderer3d.ts super-smash/src/render3d/renderer3d.test.ts
git commit -m "super-smash: the 3D presenter — survives lost contexts, resizes, never crashes on a missing model" -m "Stage, fighters, blob shadows and effects in one WebGL renderer under the 2D overlay; the buffer follows CSS size x DPR up to 1080p; a lost context pauses painting until it is restored; dispose frees every GPU resource it made." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: The match in 3D — overlay mode, the runner's presenter, the play page, the loading screen

The 2D canvas becomes a transparent overlay (`RenderState.world3d`): it keeps the HUD, port tags, projectiles, move effects (`drawMoveFx`, which also reports Kirby's Stone hiding him), the dust/ring/smoke particles, the KO flash, dizzy stars, the Final Smash aura and the magnifying glass, and stops drawing the background, platforms, fighter bodies, afterimages, shields, the sparks the 3D layer now draws, and the 2D swing arcs (sized to the 2D rig, they floated beside the 3D sword that actually swings). What the overlay still hangs on a fighter — port tag, move effects, dizzy stars, aura — it hangs on the **model's head**, not the 2D rig's height: SSBU-sized Donkey Kong is 26.3 units tall where his 2D rig was 11. The runner hands the overlay an anchor per port (`render3d/anchors.ts` `overlayAnchor`: the top of the head hurt capsule, placed through the same baked head bone `Fighter3D.bonePosition` draws — `fighterPose.test.ts` proves the two agree), computed before the overlay paints because it needs no three.js. The stage's parallax sky moves to a third canvas under the WebGL one (`renderBackground`), so a page is three stacked canvases inside the `aria-label="Match"` element. The runner paints the overlay first (it is what knows `hidden`), then the 3D world; both reach the screen at the same composite. A match starts only once every fighter has its model or a stand-in ("Loading fighters…"), and `MatchRunner.dispose()` (Plan 1 Task 17) now also frees the presenter. The fighters the runner, the renderer and the sim see are the game's (`GAME_SIM_CONTEXT.fighter`, with Task 13's limb scripts), so script motions and baked bones always agree. Online, the bake must be installed before a host builds its start config, so the engine fingerprint both peers compare is the bake's (bones, rules version and limb slots), and the lobby starts both fighters' model downloads as soon as both picks are known.

three.js stays out of every page's initial JavaScript. `world3d.ts` (which pulls in three) is reached only through `import()` — `useWorld3d()` on `/play`, loaded in parallel with the bake behind the loading screen, and the lobby's preload — and `src/app/chunkSplit.test.ts` walks each page's static import graph and fails if it reaches `three`. Measured with `next build` on the pre-Plan-1 page: `/play`'s initial scripts went from 520 KB to 356 KB gzipped with three in its own chunk (98 KB + 65 KB + 10 KB gzipped, fetched after mount); the menu's 194 KB never included it.

Verified in scratch on the pre-Plan-1 play page with the same logic: the whole e2e suite passes (20 passed, screenshots skipped), once `waitForMatch` waits on the sim's frame counter instead of a fixed 1.2 s — with a loading step before the match, "up plus attack is still an up-attack" otherwise pressed its keys while the fighter was still landing and got an up-air.

**Files:**
- Create: `super-smash/src/render3d/anchors.ts`, `super-smash/src/render3d/anchors.test.ts`, `super-smash/src/render/overlay3d.test.ts`, `super-smash/src/game/world3d.ts`, `super-smash/src/game/world3d.test.ts`, `super-smash/src/game/useBake.ts`, `super-smash/src/game/useWorld3d.ts`, `super-smash/src/game/matchRunner.presenter.test.ts`, `super-smash/src/app/chunkSplit.test.ts`
- Modify: `super-smash/src/render/renderer.ts`, `super-smash/src/render/vfx.ts`, `super-smash/src/game/matchRunner.ts`, `super-smash/src/app/play/page.tsx`, `super-smash/src/app/online/page.tsx`, `super-smash/src/components/menu/CharacterSelect.tsx` (the host's start, Plan 1 Task 20 / Plan 2 Task 27, and the lobby's picks), `super-smash/src/lib/onlineStore.ts` (the guest's `case "start"`, Plan 2 Task 27), `super-smash/e2e/helpers.ts`

**Interfaces:**
- Produces (`render/renderer.ts`): `RenderState.world3d?: boolean`, `RenderState.anchors?: readonly (OverlayAnchor | null)[]`, `OverlayAnchor { headX; headTop }` (world units from the feet, `headX` signed by facing), `OverlayResult { hidden: boolean[] }` (returned by `render` and `drawScene`), `WORLD3D_PARTICLES`, `renderBackground(ctx, stage, camera, frame)`.
- Produces (`render3d/anchors.ts`): `overlayAnchor(def, f, globalFrame, bake | undefined): OverlayAnchor | null`.
- Produces (`render/vfx.ts`): `drawParticles(ctx, v, cam, skip?)`.
- Produces (`game/matchRunner.ts`): `WorldPresenter { paint(rs, camera, alpha, hidden); dispose() }`, `MatchRunnerOptions.presenter?`, `MatchRunnerOptions.background?`; `dispose()` frees the presenter.
- Produces (`game/world3d.ts`): `sharedModels()`, `preloadModels(fighterIds): Promise<void>`, `WorldLayers { gl; background }`, `createWorld(layers, stage, defs, bake): Presenter3D`, `followSize(canvas, presenter): () => void`.
- Produces (`game/useBake.ts`): `useBake(): { tables; error }`. (`ensureBakeInstalled` is Task 11's.)
- Produces (`game/useWorld3d.ts`): `World3dModule = typeof import("./world3d")`, `useWorld3d(): { world: World3dModule | null; error }`.
- Debug handle: `window.__smashRender = { info(): RenderInfo }` while a match is mounted.

- [ ] **Step 1: Write the failing tests** — `src/game/matchRunner.presenter.test.ts`:

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { MatchRules } from "@/engine/types";
import { createMockContext } from "@/render/mockContext";
import { overlayAnchor } from "@/render3d/anchors";
import { installBake } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
import { GAME_SIM_CONTEXT } from "./simContext";
import { createMatchRunner, type WorldPresenter } from "./matchRunner";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 60 * 60 * 7, smashBall: false, oneOnOne: true };

function canvasWith(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1920;
  c.height = 1080;
  vi.spyOn(c, "getContext").mockReturnValue(ctx as never);
  return c;
}

beforeAll(() => bootstrapEngine());

describe("the match runner with a 3D presenter", () => {
  it("paints the world in 3D every frame, under a transparent overlay that keeps the HUD", () => {
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const overlay = createMockContext();
    const background = createMockContext();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: [
        { selection: { defId: "mario" }, cpuLevel: null },
        { selection: { defId: "kirby" }, cpuLevel: null },
      ],
      rules: RULES,
      getFighter: getFighterOrThrow,
      presenter,
      background: canvasWith(background),
    });
    runner.start(canvasWith(overlay));
    runner.stop();
    runner.advance(3);
    expect(presenter.paint).toHaveBeenCalledTimes(1);
    const [rs, , , hidden] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rs.world3d).toBe(true);
    expect(hidden).toEqual([false, false]);
    runner.dispose();
    expect(presenter.dispose).toHaveBeenCalledOnce();
    // The overlay is cleared, never filled black: the 3D layer must show through.
    expect(overlay.calls.some((c) => c.method === "clearRect")).toBe(true);
    expect(overlay.calls.some((c) => c.method === "fillRect" && c.args[2] === 1920 && c.args[3] === 1080)).toBe(false);
    // The stage's sky is painted on the background canvas under the 3D layer.
    expect(background.calls.some((c) => c.method === "fillRect")).toBe(true);
  });
});

describe("the overlay's anchors over the 3D world", () => {
  it("hands the overlay each fighter's head, from the installed bake", () => {
    installBake(readBakeFromDisk());
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: [
        { selection: { defId: "donkeyKong" }, cpuLevel: null },
        { selection: { defId: "kirby" }, cpuLevel: null },
      ],
      rules: RULES,
      getFighter: (id) => GAME_SIM_CONTEXT.fighter(id),
      presenter,
      background: canvasWith(createMockContext()),
    });
    runner.start(canvasWith(createMockContext()));
    runner.stop();
    runner.advance(1);
    const [rs] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rs.anchors).toHaveLength(2);
    runner.state.fighters.forEach((f, i) => {
      expect(rs.anchors[i]).toEqual(overlayAnchor(GAME_SIM_CONTEXT.fighter(f.defId), f, runner.state.frame, GAME_SIM_CONTEXT.bake));
      expect(rs.anchors[i].headTop).toBeGreaterThan(5);
    });
    runner.dispose();
  });
});
```

`src/render/overlay3d.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { fx } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { createCamera, worldToScreen } from "./camera";
import * as characterArt from "./characterArt";
import { createHudState } from "./hud";
import { createMockContext } from "./mockContext";
import { drawScene, visualHeight, type OverlayAnchor, type RenderState } from "./renderer";
import { getCharacterRig } from "./chars";
import * as swing from "./swing";
import { makeFighter, makeState, makeStage } from "./testFixtures";
import * as vfx from "./vfx";

vi.mock("./characterArt", async (orig) => ({ ...(await orig<typeof import("./characterArt")>()), drawPortTag: vi.fn() }));
vi.mock("./swing", async (orig) => ({ ...(await orig<typeof import("./swing")>()), drawSwingArc: vi.fn() }));
vi.mock("./vfx", async (orig) => ({ ...(await orig<typeof import("./vfx")>()), drawDizzyStars: vi.fn(), drawFinalSmashAura: vi.fn() }));

const dk = FIGHTERS.find((f) => f.id === "donkeyKong")!;
const marth = FIGHTERS.find((f) => f.id === "marth")!;

function stateWith(world3d: boolean, anchors: readonly (OverlayAnchor | null)[] | undefined, fighters = [
  makeFighter({ port: 0, defId: "donkeyKong", x: fx(-10), action: "shieldBroken", actionFrame: 30 }),
  makeFighter({ port: 1, defId: "marth", x: fx(10), action: "attack", move: "fsmash", actionFrame: 12 }),
]): RenderState {
  return {
    current: makeState({ fighters }),
    previous: null,
    stage: makeStage(),
    fighters: [dk, marth],
    vfx: vfx.createVfx(),
    hud: createHudState(),
    world3d,
    anchors,
  };
}

describe("the overlay over the 3D world (Plan 4, MAJOR 5)", () => {
  it("puts port tags, dizzy stars and the Final Smash aura over the model's head bone, not the 2D rig's height", () => {
    vi.clearAllMocks();
    const cam = createCamera();
    const anchors: OverlayAnchor[] = [{ headX: 4, headTop: 26.3 }, { headX: 0.4, headTop: 18.8 }];
    drawScene(createMockContext(), stateWith(true, anchors), null, cam, 1);
    const tags = vi.mocked(characterArt.drawPortTag).mock.calls;
    expect(tags).toHaveLength(2);
    // DK faces right (+1): his head is 4 units in front of his feet at x = -10.
    const head = worldToScreen(cam, -10 + 4, 26.3 + 1);
    expect(tags[0][1]).toBeCloseTo(head.x, 5);
    expect(tags[0][2]).toBeCloseTo(head.y - 14, 5);
    expect(vi.mocked(vfx.drawDizzyStars).mock.calls[0][3]).toBe(26.3);
    expect(vi.mocked(vfx.drawFinalSmashAura).mock.calls[1][3]).toBe(18.8);
  });

  it("draws no 2D swing arc over a 3D sword", () => {
    vi.clearAllMocks();
    drawScene(createMockContext(), stateWith(true, [null, null]), null, createCamera(), 1);
    expect(swing.drawSwingArc).not.toHaveBeenCalled();
  });

  it("keeps the 2D rig's heights and swing arcs in the 2D renderer", () => {
    vi.clearAllMocks();
    drawScene(createMockContext(), stateWith(false, undefined), null, createCamera(), 1);
    expect(swing.drawSwingArc).toHaveBeenCalled();
    expect(vi.mocked(vfx.drawDizzyStars).mock.calls[0][3]).toBe(visualHeight(getCharacterRig("donkeyKong")));
  });
});
```

`src/render3d/anchors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { LEGACY_BAKE } from "@/engine/acmd/bakeTables";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { overlayAnchor } from "./anchors";
import { fighterPoser } from "./bake/bake";
import { createFighter3D } from "./fighter3d";
import { parseSkeletonFile } from "./skeleton/skeleton";

const bake = readBakeFromDisk();
const dk = withLimbScripts(FIGHTERS.find((f) => f.id === "donkeyKong")!);

describe("where the overlay hangs a fighter's tag (Plan 4)", () => {
  it("is the top of the head hurt capsule, over the head, mirrored by facing", () => {
    for (const facing of [1, -1]) {
      const f = makeFighter({ defId: "donkeyKong", facing });
      const a = overlayAnchor(dk, f, 0, bake)!;
      const caps = localHurtboxes(dk, f, 0, bake)!;
      const head = caps[bake.hurtboxes("donkeyKong")!.findIndex((h) => h.bone === "head")];
      expect(a.headTop).toBeCloseTo(toFloat(Math.max(head.y1, head.y2) + head.r), 6);
      expect(a.headX).toBeCloseTo(facing * toFloat((head.x1 + head.x2) / 2), 6);
      expect(a.headTop).toBeGreaterThan(20); // SSBU DK, not his 2D rig's 11
    }
  });

  it("follows the head bone Fighter3D draws: the head comes down in a crouch", () => {
    const stand = overlayAnchor(dk, makeFighter({ defId: "donkeyKong" }), 0, bake)!;
    const crouch = overlayAnchor(dk, makeFighter({ defId: "donkeyKong", action: "crouch", actionFrame: 10 }), 0, bake)!;
    expect(crouch.headTop).toBeLessThan(stand.headTop - 1); // 26.3 → 25.1: DK crouches on short legs
    const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "donkeyKong.json"), "utf8")));
    const fighter = createFighter3D({ def: dk, port: 0, poser: fighterPoser(dk, skeleton), bake, model: { kind: "standIn", reason: "test" } });
    const f = makeFighter({ defId: "donkeyKong", x: fx(3), action: "crouch", actionFrame: 10 });
    fighter.update({ f, x: 3, y: 0, frame: 0, blends: null, hitFlash: 0, hidden: false });
    const p = new Vector3();
    expect(fighter.bonePosition("head", p)).toBe(true);
    // The tag sits over the head bone: within the head capsule's own reach of it.
    expect(Math.abs(3 + crouch.headX - p.x)).toBeLessThan(6);
    expect(crouch.headTop).toBeGreaterThan(p.y);
    fighter.dispose();
  });

  it("is null without a bake, so the overlay falls back to the 2D rig", () => {
    expect(overlayAnchor(dk, makeFighter({ defId: "donkeyKong" }), 0, LEGACY_BAKE)).toBeNull();
    expect(overlayAnchor(dk, makeFighter({ defId: "donkeyKong" }), 0, undefined)).toBeNull();
  });
});
```

`src/game/world3d.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { preloadModels, sharedModels } from "./world3d";

afterEach(() => vi.unstubAllGlobals());

describe("the page's model cache", () => {
  it("preloads the lobby's fighters into the cache the match will use, and never throws", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await preloadModels(["mario", "fox"]);
    expect(fetchMock).toHaveBeenCalledWith("/models/index.json", { cache: "no-cache" });
    expect(sharedModels().status()).toEqual({ mario: "standIn", fox: "standIn" });
  });
});
```

`src/app/chunkSplit.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * three.js (~200 KB gzipped) belongs in the chunk the play page loads after it
 * mounts, never in a page's initial JavaScript (Plan 4): the menu must not pay
 * for it at all, and /play only once its loading screen is up. The bundler puts
 * every module reachable through *static* imports in a page's initial chunk, so
 * this walks that graph from each page and fails if it reaches `three`.
 * `import type` and `import()` are not static edges.
 */

const SRC = join(process.cwd(), "src");
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx", ".json", ""];

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (base === null) return null;
  for (const e of EXT) if (existsSync(base + e) && (e !== "" || /\.(tsx?|json)$/.test(base))) return base + e;
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

/** Bare packages and dynamically imported files reachable from `entry` through static imports. */
function walk(entry: string): { packages: Set<string>; dynamic: Set<string> } {
  const packages = new Set<string>();
  const dynamic = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || file.endsWith(".json")) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
      const target = resolveSpec(file, m[1]);
      if (target === null) packages.add(m[1].split("/").slice(0, m[1].startsWith("@") ? 2 : 1).join("/"));
      else queue.push(target);
    }
    for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveSpec(file, m[1]);
      if (target !== null) dynamic.add(target.slice(SRC.length + 1));
    }
  }
  return { packages, dynamic };
}

describe("three.js stays out of every page's initial chunk (Plan 4)", () => {
  for (const page of ["page.tsx", "menu/page.tsx", "play/page.tsx", "results/page.tsx"]) {
    it(`src/app/${page} reaches no three.js through static imports`, () => {
      expect([...walk(join(SRC, "app", page)).packages].filter((p) => p === "three" || p.startsWith("three/"))).toEqual([]);
    });
  }

  it("the play page still loads the 3D world, as a separate chunk", () => {
    expect(walk(join(SRC, "app", "play", "page.tsx")).dynamic).toContain("game/world3d.ts");
  });

  it("the walk does see three where it is static (the lab)", () => {
    expect(walk(join(SRC, "app", "anim", "page.tsx")).packages).toContain("three");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/game/matchRunner.presenter.test.ts src/render/overlay3d.test.ts src/render3d/anchors.test.ts src/game/world3d.test.ts src/app/chunkSplit.test.ts`
Expected: FAIL —
- `Error: Failed to resolve import "@/render3d/anchors" from "src/game/matchRunner.presenter.test.ts". Does the file exist?`, `Error: Failed to resolve import "./anchors" from "src/render3d/anchors.test.ts". Does the file exist?`, `Error: Failed to resolve import "./world3d" from "src/game/world3d.test.ts". Does the file exist?`;
- `overlay3d.test.ts`: `AssertionError: expected 896.1621 to be close to 924, received difference is 27.83789999999999, but expected 0.000005` (the tag sits over the 2D rig) and `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` (the 2D swing arc is drawn);
- `chunkSplit.test.ts`: "the play page still loads the 3D world, as a separate chunk" — `AssertionError: expected [ … ] to include 'game/world3d.ts'` (the array is the page's existing dynamic imports); its other five tests pass.

- [ ] **Step 3: Implement the overlay** — `src/render/vfx.ts`: give `drawParticles` a fourth parameter and skip those kinds:

```ts
export function drawParticles(
  ctx: CanvasRenderingContext2D,
  v: VfxState,
  cam: Camera,
  /** Kinds another layer draws (the 3D sprites, Plan 4); skipped here. */
  skip?: ReadonlySet<ParticleKind>,
): void {
  ctx.save();
  ctx.lineCap = "butt";
  for (const p of v.particles) {
    if (skip?.has(p.kind)) continue;
```

`src/render/renderer.ts` (by symbol):
1. Add `type ParticleKind,` to the `./vfx` import list.
2. In `interface RenderState`, after `showBlastZone`:

```ts
  /**
   * The world — background, platforms, fighters, shields, sparks — is drawn by
   * the 3D presenter underneath (Plan 4); this canvas is the transparent overlay
   * that carries everything else.
   */
  readonly world3d?: boolean;
  /**
   * Per port, where the 3D model's head is this frame (`render3d/anchors.ts`,
   * from the same baked head bone `Fighter3D` draws). With `world3d`, port
   * tags, move effects, dizzy stars and the Final Smash aura hang off it
   * instead of the 2D rig's height — SSBU-sized DK is twice his 2D rig.
   */
  readonly anchors?: readonly (OverlayAnchor | null)[];
```

and after the interface:

```ts
/** A fighter's head in the 3D world, relative to their feet, in world units. */
export interface OverlayAnchor {
  /** Forward of the feet, already signed by facing. */
  readonly headX: number;
  /** Top of the head hurt capsule above the feet. */
  readonly headTop: number;
}

/** What the overlay learned while drawing that the 3D layer needs this frame. */
export interface OverlayResult {
  /** `hidden[port]`: a move effect replaces the fighter (Kirby's Stone). */
  readonly hidden: boolean[];
}

/** Particle kinds the 3D layer draws (`render3d/vfx3d.ts` SPRITE_KINDS, repeated so render/ never imports three). */
export const WORLD3D_PARTICLES: ReadonlySet<ParticleKind> = new Set<ParticleKind>(["spark", "burst"]);
```

3. `render(...)` returns `OverlayResult`: its black `fillRect` becomes

```ts
  if (state.world3d) {
    // The 3D layer shows through; the overlay only adds to it.
    ctx.clearRect(0, 0, canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);
  }
```

and its tail `drawScene(ctx, state, events, camera, interpolationAlpha); ctx.restore();` becomes `const result = drawScene(…); ctx.restore(); return result;`. Add after `render`:

```ts
/**
 * The background canvas under the 3D layer: the stage's parallax sky, letterboxed
 * like everything else. Only used with `world3d`.
 */
export function renderBackground(ctx: CanvasRenderingContext2D, stage: StageDef, camera: Camera, frame: number): void {
  const canvas = ctx.canvas;
  const box = computeLetterbox(canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas?.width ?? INTERNAL_WIDTH, canvas?.height ?? INTERNAL_HEIGHT);
  ctx.translate(box.offsetX, box.offsetY);
  ctx.scale(box.scale, box.scale);
  drawBackground(ctx, stage, camera, frame);
  ctx.restore();
}
```

4. `drawScene(...)` returns `OverlayResult`: start it with `const hidden = game.fighters.map(() => false);`, wrap `drawBackground(…); drawPlatforms(…);` in `if (!state.world3d) { … }`, guard `drawAfterimages(…)` with `if (!state.world3d)`, make the swing-arc loop skip the 3D world — its comment gains "Not over the 3D world: there the sword itself swings, and a 2D arc sized to the 2D rig floated beside it." and its head becomes `for (const d of state.world3d ? [] : drawn) {` — change the fighter loop body to `hidden[d.fighter.port] = drawOneFighter(ctx, state, camera, d, mode);`, pass `state.world3d ? WORLD3D_PARTICLES : undefined` as `drawParticles`'s fourth argument, and end with `return { hidden };`.
5. `drawOneFighter(...)` returns `boolean`. Replace `const height = visualHeight(rig);` with

```ts
  const anchor = state.world3d ? (state.anchors?.[f.port] ?? null) : null;
  const height = anchor ? anchor.headTop : visualHeight(rig);
```

(so `drawMoveFx`, `drawFinalSmashAura` and `drawDizzyStars` size and place themselves on the model); guard the port ring with `!state.world3d && f.grounded && …`, the figure with `if (!fx.hideFigure && !state.world3d) { …rim and body… }`, and `drawShield(…)` with `if (!state.world3d)`; and between `const label = …;` and `const clearance = …;` put the 3D tag, ending the function early:

```ts
  if (anchor) {
    // A unit over the head capsule: the capsule covers three quarters of the
    // head's vertices, so ears and hat brims stand a little proud of it.
    const head = worldToScreen(cam, d.x + anchor.headX, d.y + anchor.headTop + 1);
    drawPortTag(ctx, head.x, head.y - 14, f.port, label, Math.max(0.6, cam.zoom / 7));
    return fx.hideFigure;
  }
```

with `return fx.hideFigure;` also at its end.

`src/render3d/anchors.ts`:

```ts
/**
 * Where the 2D overlay hangs a fighter's port tag, move effects, dizzy stars
 * and Final Smash aura over the 3D world (Plan 4): the top of the head hurt
 * capsule, placed through the same baked head bone `Fighter3D` draws
 * (`fighterPose.test.ts` proves the two agree). Pure: no three.js, so the
 * match runner computes it before the overlay paints.
 */

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import type { ClockedFighter } from "@/engine/acmd/poseClock";
import { toFloat } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import type { OverlayAnchor } from "@/render/renderer";
import { hurtBonesFor } from "./skeletons/hurtBones";

/** The head's anchor this frame, or null without a bake (the overlay then uses the 2D rig). */
export function overlayAnchor(
  def: FighterDef,
  f: ClockedFighter & { readonly facing: number },
  globalFrame: number,
  bake: BakeTables | undefined,
): OverlayAnchor | null {
  if (bake === undefined) return null;
  const caps = localHurtboxes(def, f, globalFrame, bake);
  if (caps === null) return null;
  const want = hurtBonesFor(def.id).head.toLowerCase();
  const i = (bake.hurtboxes(def.id) ?? []).findIndex((h) => h.bone === want);
  if (i < 0) return null;
  const c = caps[i];
  return { headX: (f.facing >= 0 ? 1 : -1) * toFloat((c.x1 + c.x2) / 2), headTop: toFloat(Math.max(c.y1, c.y2) + c.r) };
}
```

- [ ] **Step 4: Implement the runner's presenter** — `src/game/matchRunner.ts`:
1. Imports: `import { render, renderBackground, type RenderState } from "@/render/renderer";`, and `import { overlayAnchor } from "@/render3d/anchors";` before `import { GAME_SIM_CONTEXT } from "./simContext";` (`anchors.ts` imports no three.js).
2. In `MatchRunnerOptions`, after `debugSilhouette`:

```ts
  /**
   * The 3D world under the overlay canvas (Plan 4, `render3d/renderer3d.ts`).
   * Absent: the whole frame is drawn in 2D on the canvas given to `start`.
   */
  readonly presenter?: WorldPresenter | null;
  /** The stage's 2D background, under the 3D layer. Only read with a presenter. */
  readonly background?: HTMLCanvasElement | null;
}

/** What the match runner needs from the 3D presenter. Structural, so tests can fake it. */
export interface WorldPresenter {
  paint(rs: RenderState, camera: Camera, alpha: number, hidden: readonly boolean[]): void;
  dispose(): void;
```

3. Destructure `presenter = null, background = null,` with the other options.
4. Replace `paint` with:

```ts
  const bgCtx = presenter && background ? background.getContext("2d") : null;

  function paint(alpha: number): void {
    if (!ctx) return;
    const rs: RenderState = {
      current: state,
      previous,
      stage,
      fighters: defs,
      labels: players.map((p, i) => p.label ?? defs[i]?.name ?? ""),
      cpu: players.map((p) => p.cpuLevel !== null),
      vfx,
      hud,
      debugSilhouette,
      world3d: presenter !== null,
      // The 3D model's head, from the bake the sim steps with (Plan 4).
      anchors: presenter === null ? undefined : state.fighters.map((f) => (defs[f.port] ? overlayAnchor(defs[f.port]!, f, state.frame, GAME_SIM_CONTEXT.bake) : null)),
    };
    if (bgCtx) renderBackground(bgCtx, stage, camera, state.frame);
    // The overlay first: it is what knows a move effect hides its fighter this
    // frame. Both canvases reach the screen at the same composite either way.
    const overlay = render(ctx, rs, events, camera, alpha);
    presenter?.paint(rs, camera, alpha, overlay.hidden);
  }
```

5. In Plan 1's `dispose()` member, add `presenter?.dispose();` after `session?.close();`.

- [ ] **Step 5: The world helper and the hooks** — `src/game/world3d.ts`:

```ts
/**
 * The 3D layer of a match, as the play page builds it (Plan 4): one presenter
 * per match over the page's WebGL canvas, the fighters' models from a cache
 * shared across matches (a rematch does not re-download a glb), and the buffer
 * kept to the canvas's on-screen size and the display's pixel ratio.
 */

import type { BakeTables } from "@/engine/acmd/bakeTables";
import type { FighterDef, StageDef } from "@/engine/types";
import { browserModelSource, createModelCache, type ModelCache } from "@/render3d/models/loader";
import { createRenderer3D, type Presenter3D } from "@/render3d/renderer3d";
import { SKELETONS } from "@/render3d/skeletons";

let models: ModelCache | null = null;

/** The page's model cache: built on first use, kept for the page's lifetime. */
export function sharedModels(): ModelCache {
  models ??= createModelCache(browserModelSource());
  return models;
}

/**
 * Start fetching these fighters' models now — the online lobby calls it (via
 * `import()`, keeping three.js out of the lobby's own chunk) as soon as both
 * picks are known, so a match never starts on a stand-in only because its
 * download was still running.
 */
export function preloadModels(fighterIds: readonly string[]): Promise<void> {
  return sharedModels().preload(fighterIds);
}

export interface WorldLayers {
  /** The WebGL canvas, under the overlay. */
  readonly gl: HTMLCanvasElement;
  /** The 2D canvas for the stage's sky, under the WebGL canvas. */
  readonly background: HTMLCanvasElement;
}

/** A presenter for one match. Its `ready` resolves once every fighter has a model or a stand-in. */
export function createWorld(layers: WorldLayers, stage: StageDef, defs: readonly FighterDef[], bake: BakeTables): Presenter3D {
  return createRenderer3D({ canvas: layers.gl, stage, defs, bake, skeletons: SKELETONS, models: sharedModels() });
}

/** Keep the presenter's buffer to the canvas's CSS size × DPR; returns the unsubscribe. */
export function followSize(canvas: HTMLCanvasElement, presenter: Pick<Presenter3D, "resize">): () => void {
  const apply = () => {
    const r = canvas.getBoundingClientRect();
    presenter.resize(r.width, r.height, window.devicePixelRatio || 1);
  };
  apply();
  const observer = new ResizeObserver(apply);
  observer.observe(canvas);
  // A DPR change (dragging the window to another display) fires no resize.
  let dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onDpr = () => {
    apply();
    dpr.removeEventListener("change", onDpr);
    dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dpr.addEventListener("change", onDpr);
  };
  dpr.addEventListener("change", onDpr);
  return () => {
    observer.disconnect();
    dpr.removeEventListener("change", onDpr);
  };
}
```

`src/game/useBake.ts`:

```ts
"use client";

/**
 * The bake, loaded and installed for a page that plays or prepares a match
 * (Plan 4). `/play` waits for it before mounting; `/online` loads it on arrival
 * so the engine fingerprint a host puts in its start config is the bake's.
 */

import { useEffect, useState } from "react";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { ensureBakeInstalled } from "./bake";

export function useBake(): { readonly tables: BakeTables | null; readonly error: string | null } {
  const [state, setState] = useState<{ tables: BakeTables | null; error: string | null }>({ tables: null, error: null });
  useEffect(() => {
    let live = true;
    ensureBakeInstalled().then(
      (tables) => live && setState({ tables, error: null }),
      (e: unknown) => live && setState({ tables: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
```

`src/game/useWorld3d.ts`:

```ts
"use client";

/**
 * The 3D world's code, loaded after the page mounts (Plan 4). `world3d.ts`
 * pulls in three.js (~200 KB gzipped); importing it statically put all of it
 * in /play's initial chunk, ahead of the loading screen. Loaded here instead,
 * in parallel with the bake, as its own chunk (`src/app/chunkSplit.test.ts`).
 */

import { useEffect, useState } from "react";

export type World3dModule = typeof import("./world3d");

export function useWorld3d(): { readonly world: World3dModule | null; readonly error: string | null } {
  const [state, setState] = useState<{ world: World3dModule | null; error: string | null }>({ world: null, error: null });
  useEffect(() => {
    let live = true;
    import("./world3d").then(
      (world) => live && setState({ world, error: null }),
      (e: unknown) => live && setState({ world: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/game src/render src/render3d/anchors.test.ts`
Expected: PASS (presenter 2 tests, overlay3d 3, anchors 3, world3d 1; every existing 2D renderer and runner test unchanged — `world3d` absent means exactly the old frame). `chunkSplit.test.ts` still fails until Step 7.

- [ ] **Step 7: The play page** — `src/app/play/page.tsx` as Plan 1 Task 21 left it, by symbol:
1. Imports: add (`world3d.ts` only as a type — the module itself arrives through `useWorld3d`'s `import()`, never a static edge)

```ts
import type { BakeTables } from "@/engine/acmd/bakeTables";
import { GAME_SIM_CONTEXT } from "@/game/simContext";
import { useBake } from "@/game/useBake";
import { useWorld3d, type World3dModule } from "@/game/useWorld3d";
import type { WorldLayers } from "@/game/world3d";
```

2. `interface MountArgs`: add

```ts
  /** The WebGL and background canvases under `canvas` (Plan 4). */
  readonly layers: WorldLayers;
  readonly bake: BakeTables;
  /** `world3d.ts`, loaded by `useWorld3d` (three.js in its own chunk). */
  readonly world: World3dModule;
  /** Every fighter has a model or a stand-in; the match has started. */
  readonly onReady: () => void;
  readonly onError: (message: string) => void;
```

3. `mountMatch`: before `const runner = createMatchRunner({`, add

```ts
  // The 3D world under the overlay (Plan 4), drawing the game's fighters — the
  // same defs, limb-bone scripts and all, that the sim steps.
  const presenter = args.world.createWorld(args.layers, args.stage, slots.map((s) => GAME_SIM_CONTEXT.fighter(s.selection.defId)), args.bake);
  const stopFollowing = args.world.followSize(args.layers.gl, presenter);
```

in the `createMatchRunner({…})` options replace `getFighter: getFighterOrThrow,` with `getFighter: (id) => GAME_SIM_CONTEXT.fighter(id),` and add `presenter,` and `background: args.layers.background,`; after the `__smashDebug` assignment add

```ts
  // What the 3D layer is doing, for e2e (Plan 4): draw calls, triangles, buffer, lost context, models.
  (window as unknown as { __smashRender?: unknown }).__smashRender = { info: () => presenter.info() };
```

replace `const mounted: Mounted = { runner, dispose() { runner.dispose(); …` with a version that records disposal and also stops following and drops the handle:

```ts
  let disposed = false;
  const mounted: Mounted = {
    runner,
    dispose() {
      disposed = true;
      stopFollowing();
      runner.dispose();
      releaseAudioGesture?.();
      // Disposed, not just silenced: browsers cap how many AudioContexts a
      // page may hold, and leaking one per match eventually mutes the game.
      audio?.dispose();
      delete (window as unknown as { __smashDebug?: unknown }).__smashDebug;
      delete (window as unknown as { __smashRender?: unknown }).__smashRender;
    },
  };
```

and replace the closing `try { runner.start(canvas); } catch (e) { mounted.dispose(); throw e; } return mounted;` with

```ts
  // The match starts once every fighter has its model or a stand-in, so nobody
  // plays the first second against an invisible opponent.
  void presenter.ready.then(() => {
    if (disposed) return;
    args.onReady();
    try {
      runner.start(canvas);
    } catch (e) {
      mounted.dispose();
      args.onError(e instanceof Error ? e.message : String(e));
    }
  });
  return mounted;
```

4. `PlayPage`: add beside `canvasRef`

```ts
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const bake = useBake();
  const { world, error: worldError } = useWorld3d();
  const [loading, setLoading] = useState(true);
```

In **both** match effects (local and online), replace `const canvas = canvasRef.current; if (!canvas) return;` with

```ts
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const background = bgRef.current;
    if (!canvas || !gl || !background || bake.tables === null || world === null) return;
    const tables = bake.tables;
```

pass to each `mountMatch({…})` call

```ts
        layers: { gl, background },
        bake: tables,
        world,
        onReady: () => setLoading(false),
        onError: (message) => setError(message),
```

and add `bake.tables` and `world` to each effect's dependency array. The Escape handler's `runnerRef.current?.start(canvas)` is unchanged.

5. JSX: replace the match `<canvas … aria-label="Match" … />` with

```tsx
      <div aria-label="Match" className="relative h-full w-full">
        <canvas ref={bgRef} width={INTERNAL_WIDTH} height={INTERNAL_HEIGHT} className="absolute inset-0 h-full w-full" />
        <canvas ref={glRef} data-layer="world" className="absolute inset-0 h-full w-full" />
        <canvas ref={canvasRef} width={INTERNAL_WIDTH} height={INTERNAL_HEIGHT} className="absolute inset-0 h-full w-full" />
        {loading && !error && (
          <p role="status" className="absolute inset-x-0 bottom-8 text-center font-menu text-sm text-white/70">
            {bake.error ?? worldError ?? "Loading fighters…"}
          </p>
        )}
      </div>
```

and make the error overlay show `error ?? bake.error ?? worldError` (a bake that fails its digest says "…does not match this version of the game. Reload the page.").

Run: `pnpm vitest run src/app/chunkSplit.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Online** (written against Plan 1 Task 20 and Plan 2 Task 27's code by symbol; this base has no `/online`, so these edits are the one part of the task not run in scratch — Step 10's online e2e is their test)
1. `src/app/online/page.tsx`: call `useBake();` at the top of its component (the result is unused; the hook installs the bake on arrival).
2. `src/components/menu/CharacterSelect.tsx`, the host's Ready handler (the code that calls `buildStartConfig(…)` and sends `start`): make it `async` and run `await ensureBakeInstalled();` (from `@/game/bake`) before `buildStartConfig`, so the `bones` fingerprint it carries is the bake's even if the host clicks Ready before `/online`'s effect finished; a bake that cannot load leaves the handler throwing the bake's own message, which the lobby shows as its error. In the same component, where online mode knows both players' picks (the `pick` messages Plan 1 Task 20 applies), start both downloads once per pair:

```ts
  // Both picks known: fetch the two models now, so the match starts with them (Plan 4).
  const picks = `${hostPick}|${guestPick}`;
  useEffect(() => {
    if (!online || !hostPick || !guestPick) return;
    void import("@/game/world3d").then((w) => w.preloadModels([hostPick, guestPick]));
  }, [online, picks]); // eslint-disable-line react-hooks/exhaustive-deps
```

(`hostPick`/`guestPick`/`online` are the component's names for the two ports' selected fighter ids and its online flag — use the ones Plan 1 Task 20 gave it; the `import()` keeps three.js out of the lobby's chunk.)
3. `src/lib/onlineStore.ts`, the guest's `case "start": {` (Plan 2 Task 27): wrap its body after `if (session.role !== "guest") return;` in

```ts
      void (async () => {
        // The bake first: the fingerprint compared below must be the bake's (Plan 4).
        await ensureBakeInstalled();
        const problem = startConfigProblem(message.config);
        // …the rest of Plan 2's body unchanged: refuse on a problem, else patch the config…
      })();
      return;
```

with `import { ensureBakeInstalled } from "@/game/bake";` beside its `startConfigProblem` import.

- [ ] **Step 9: e2e waits on the sim, not the clock** — `e2e/helpers.ts`: replace `waitForMatch` with

```ts
/**
 * Wait until the match is actually running and past the entry animation.
 *
 * With the 3D renderer (Plan 4) a match starts only once its fighters' models
 * (or stand-ins) are ready, which takes a variable time — so this waits on the
 * simulation's own frame counter rather than on the wall clock: 70 frames is
 * past the 12-frame entry and the landing that follows it, so the fighters are
 * standing on the stage when the test presses anything.
 */
export async function waitForMatch(page: Page): Promise<void> {
  await page.getByLabel("Match").waitFor();
  await page.waitForFunction(() => ((window as unknown as { __smashDebug?: { frame: number } }).__smashDebug?.frame ?? 0) >= 70, undefined, {
    timeout: 30_000,
  });
}
```

- [ ] **Step 10: Gate, build and e2e**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && PORT=3107 pnpm test:e2e`
Expected: exit 0; e2e as before (with or without `pnpm models` — without, every fighter is a stand-in), Plan 1 Task 22's two-browser online e2e included. Optionally confirm the chunk split on the build: no `/play` initial script contains `WebGLRenderer` (`grep -l WebGLRenderer .next/static/chunks/*.js` lists only chunks the page fetches after mount).

- [ ] **Step 11: Look at it** (`pnpm dev`, then a CPU match): the stage and fighters in 3D, HUD and port tags over the right fighters, the stage's sky behind. If `pnpm models` has run, the fighters are their SSBU models; otherwise capsule stand-ins in port colours and a console line per fighter.

- [ ] **Step 12: Commit**

```bash
git add super-smash/src/render/renderer.ts super-smash/src/render/vfx.ts super-smash/src/render/overlay3d.test.ts super-smash/src/render3d/anchors.ts super-smash/src/render3d/anchors.test.ts super-smash/src/game/matchRunner.ts super-smash/src/game/matchRunner.presenter.test.ts super-smash/src/game/world3d.ts super-smash/src/game/world3d.test.ts super-smash/src/game/useBake.ts super-smash/src/game/useWorld3d.ts super-smash/src/app/chunkSplit.test.ts super-smash/src/app/play/page.tsx super-smash/src/app/online/page.tsx super-smash/src/components/menu/CharacterSelect.tsx super-smash/src/lib/onlineStore.ts super-smash/e2e/helpers.ts
git commit -m "super-smash: play matches in 3D under a 2D overlay" -m "The 2D canvas becomes a transparent overlay (HUD, tags, projectiles, move effects, the magnifying glass); tags, effects, dizzy stars and the Final Smash aura hang on the model's head bone, and the 2D swing arcs are gone from the 3D view. The stage sky moves to a canvas under the WebGL layer; the runner paints the overlay then the 3D world and frees it on dispose. three.js loads as its own chunk after /play mounts, never in a page's initial JavaScript. A match starts once every fighter has a model or a stand-in; online, the bake is installed before a start is built or checked, and the lobby preloads both models. e2e waits on the sim's frame counter." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: The animation lab and the capture scripts in 3D

The lab gains a model sheet: the fighter's model posed by the same `drawnPose` the match uses, one cell per frame at the action's true length, with the sim's own hitboxes (red) and hurtboxes (yellow) drawn over each cell from the installed bake — so a clip is tuned against the limbs and boxes the game plays (D52). One WebGL renderer draws every cell through a scissor rectangle. Verified in scratch: Mario's forward tilt (a Task 13 limb-bone script) drew 25 cells with its three hitboxes on frames 5–7.

**Files:**
- Create: `super-smash/src/app/anim/Lab3D.tsx`
- Modify: `super-smash/src/app/anim/page.tsx` (export `fighterAt`; render `<Lab3D>`), `super-smash/scripts/animsheet.mjs` (`--view 3d`), `super-smash/scripts/fightsheet.mjs` (wait on the sim)

**Interfaces:**
- Produces: `labBoxes(o, f, frame, bake): { hit: Capsule[]; hurt: Capsule[] }`, `Lab3D({ options, total, frame })` (aria-label "Model sheet").

- [ ] **Step 1: Implement** — `src/app/anim/page.tsx`: change `function fighterAt(o: Options, frame: number): FighterState {` to `export function fighterAt(…)`, add `import { Lab3D } from "./Lab3D";` after the `@/fighters` import, and render `<Lab3D options={o} total={total} frame={Math.min(frame, total - 1)} />` immediately before the `Playback` canvas.

`src/app/anim/Lab3D.tsx`:

```tsx
"use client";

/**
 * The animation lab in 3D (Plan 4): the fighter's SSBU model posed by the same
 * `drawnPose` the match uses, one cell per frame at the action's true length,
 * with this frame's hitboxes (red) and hurtboxes (yellow) drawn over it from the
 * sim's own bone table — so an author tunes a clip against the limbs and boxes
 * the game actually plays (D52: "the lab and the renderer disagreed four times").
 *
 * One WebGL renderer draws every cell through a scissor rectangle, so a
 * 91-frame Fire Fox is 91 cells and one context, not 91 contexts.
 */

import { useEffect, useRef, useState } from "react";
import { AmbientLight, Color, DirectionalLight, HemisphereLight, Scene, Vector3, WebGLRenderer, type PerspectiveCamera } from "three";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import { moveScriptFrame } from "@/engine/acmd/run";
import { toFloat } from "@/engine/fixed";
import type { Capsule } from "@/engine/hitbox";
import type { FighterState } from "@/engine/types";
import { installBake, loadBake } from "@/game/bake";
import { bootstrapEngine } from "@/game/bootstrap";
import { GAME_SIM_CONTEXT } from "@/game/simContext";
import { fighterPoser } from "@/render3d/bake/bake";
import { applySideCamera, createSideCamera } from "@/render3d/camera3d";
import { createFighter3D, type Fighter3D } from "@/render3d/fighter3d";
import { browserModelSource, createModelCache, type ModelCache } from "@/render3d/models/loader";
import { SKELETONS } from "@/render3d/skeletons";
import { fighterAt, type Options } from "./page";

const CELL = 150;
const COLUMNS = 12;

/** Facing-relative capsules the sim uses on this frame: hitboxes and hurtboxes, in world units. */
export function labBoxes(o: Options, f: FighterState, frame: number, bake: BakeTables): { hit: Capsule[]; hurt: Capsule[] } {
  const def = GAME_SIM_CONTEXT.fighter(o.fighterId);
  const run = f.move !== null ? moveScriptFrame(def, f) : null;
  const hit = run === null ? [] : scriptHitboxes(run.state, def.id, run.script.motion, run.gameFrame, bake.bones).map((h) => ({ x1: h.x, y1: h.y, x2: h.x2 ?? h.x, y2: h.y2 ?? h.y, r: h.radius }));
  return { hit, hurt: localHurtboxes(def, f, frame, bake) ?? [] };
}

function drawCapsules(ctx: CanvasRenderingContext2D, cam: PerspectiveCamera, ox: number, oy: number, w: number, h: number, caps: readonly Capsule[], colour: string): void {
  const toPx = (x: number, y: number) => {
    const v = new Vector3(toFloat(x), toFloat(y), 0).project(cam);
    return { x: ox + ((v.x + 1) / 2) * w, y: oy + ((1 - v.y) / 2) * h };
  };
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  for (const c of caps) {
    const a = toPx(c.x1, c.y1);
    const b = toPx(c.x2, c.y2);
    const r = Math.abs(toPx(c.x1 + c.r, c.y1).x - a.x);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.moveTo(b.x + r, b.y);
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

export function Lab3D({ options, total, frame }: { options: Options; total: number; frame: number }) {
  const gl = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [bake, setBake] = useState<BakeTables | null>(null);
  const [models] = useState<ModelCache>(() => createModelCache(browserModelSource()));
  const [fighter, setFighter] = useState<Fighter3D | null>(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let live = true;
    bootstrapEngine();
    loadBake()
      .then((t) => {
        installBake(t);
        if (live) setBake(t);
      })
      .catch((e: unknown) => live && setStatus(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (bake === null) return;
    let live = true;
    let made: Fighter3D | null = null;
    const def = GAME_SIM_CONTEXT.fighter(options.fighterId);
    void models.get(def.id).then((model) => {
      if (!live) return;
      made = createFighter3D({ def, port: 0, poser: fighterPoser(def, SKELETONS[def.id]), bake, model });
      setFighter(made);
      setStatus(model.kind === "glb" ? "model" : `stand-in (${model.reason})`);
    });
    return () => {
      live = false;
      made?.dispose();
    };
  }, [bake, models, options.fighterId]);

  useEffect(() => {
    const canvas = gl.current;
    const over = overlay.current;
    if (!canvas || !over || !fighter || !bake) return;
    const cols = Math.min(total, COLUMNS);
    const rows = Math.ceil(total / COLUMNS);
    canvas.width = over.width = cols * CELL;
    canvas.height = over.height = rows * CELL;
    const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setScissorTest(true);
    const scene = new Scene();
    scene.background = new Color(0x12151a);
    scene.add(new HemisphereLight(0xffffff, 0x445066, 1.4), new AmbientLight(0xffffff, 0.25));
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(-40, 120, 160);
    scene.add(sun, fighter.placement);
    const cam: PerspectiveCamera = createSideCamera();
    // 22 units of height per cell, centred on a standing fighter's middle; square cells.
    applySideCamera(cam, { x: 0, y: 8, zoom: 1080 / 22, shakeX: 0, shakeY: 0 });
    cam.aspect = 1;
    cam.updateProjectionMatrix();
    const ctx = over.getContext("2d")!;
    ctx.clearRect(0, 0, over.width, over.height);
    for (let i = 0; i < total; i++) {
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const f = fighterAt(options, i);
      fighter.update({ f: { ...f, x: 0, y: 0, facing: 1 }, x: 0, y: 0, frame: i, blends: null, hitFlash: 0, hidden: false });
      renderer.setViewport(col * CELL, canvas.height - (row + 1) * CELL, CELL, CELL);
      renderer.setScissor(col * CELL, canvas.height - (row + 1) * CELL, CELL, CELL);
      renderer.render(scene, cam);
      const boxes = labBoxes(options, { ...f, x: 0, y: 0, facing: 1 }, i, bake);
      drawCapsules(ctx, cam, col * CELL, row * CELL, CELL, CELL, boxes.hurt, "rgba(255,214,0,0.8)");
      drawCapsules(ctx, cam, col * CELL, row * CELL, CELL, CELL, boxes.hit, "rgba(255,60,60,0.95)");
      ctx.fillStyle = "#7C8896";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(`${i}`, col * CELL + 4, row * CELL + 12);
    }
    return () => {
      scene.remove(fighter.placement);
      renderer.dispose();
    };
  }, [fighter, bake, options, total]);

  return (
    <section>
      <div style={{ color: "#7C8896", fontSize: 12, margin: "6px 0" }}>
        model sheet — {status}; red: hitboxes, yellow: hurtboxes (the sim&apos;s own) — frame {frame}
      </div>
      <div aria-label="Model sheet" style={{ position: "relative", display: "inline-block" }}>
        <canvas ref={gl} />
        <canvas ref={overlay} style={{ position: "absolute", inset: 0 }} />
      </div>
    </section>
  );
}
```

`scripts/animsheet.mjs` (whole file now — `--view 3d`, and a default output inside the git-ignored `test-results/anim/` instead of the package root, where a capture could ride along in a commit; the repo already tracks one such stray 2D capture, `super-smash/anim-mario-land.png` — ours, not ripped, so this plan leaves it for David to keep or delete):

```js
/**
 * Capture the animation lab's contact sheet for one action, as a PNG.
 *
 * The point is to make an animation reviewable without a human watching a
 * match. `/anim` renders one cell per simulation frame at the action's true
 * length; this drives it headlessly and writes the strip to disk, so a change
 * to a clip can be looked at in a second rather than provoked in a match and
 * caught by a lucky screenshot.
 *
 *   node scripts/animsheet.mjs land                       # contact sheet
 *   node scripts/animsheet.mjs fsmash --move fsmash       # an attack
 *   node scripts/animsheet.mjs jump --fighter kirby --out /tmp/k.png
 *   node scripts/animsheet.mjs ftilt --move ftilt --view 3d
 *
 * Without --out the PNG goes to the git-ignored test-results/anim/, never the
 * repo root, so a capture cannot ride along in a commit.
 *
 * Needs the dev server up (npm run dev).
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const action = argv.find((a) => !a.startsWith("--")) ?? "land";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const fighter = flag("fighter", "mario");
const move = flag("move", "fsmash");
const base = flag("base", "http://localhost:3000");
const out = resolve(flag("out", join("test-results", "anim", `anim-${fighter}-${action}.png`)));
// --view 3d photographs the model sheet (Plan 4); the 2D views remain until Task 23.
const which = flag("view", "2d") === "3d" ? "Model sheet" : argv.includes("--playback") ? "Playback" : "Contact sheet";

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/anim`, { waitUntil: "networkidle" });

const ids = await page.getByLabel("Fighter").locator("option").allTextContents();
const picked = ids.find((id) => id.toLowerCase() === fighter.toLowerCase());
if (!picked) {
  console.error(`unknown fighter "${fighter}". Try one of: ${ids.join(", ")}`);
  await browser.close();
  process.exit(1);
}
await page.getByLabel("Fighter").selectOption(picked);
await page.getByLabel("Action").selectOption(action);
if (await page.getByLabel("Move").count()) await page.getByLabel("Move").selectOption(move);
// Freeze playback so the strip is reproducible run to run.
await page.getByRole("button", { name: /pause|play/ }).click().catch(() => {});
await page.waitForTimeout(200);

if (which === "Model sheet") await page.getByText(/model sheet — (model|stand-in)/).waitFor({ timeout: 30000 });
const title = (await page.locator("h1").innerText()).replace(/\s+/g, " ");
await page.getByLabel(which).screenshot({ path: out });
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`${title}\n${out}`);
```

`scripts/fightsheet.mjs`: replace `await page.getByLabel("Match").waitFor();` + `await page.waitForTimeout(1400);` with

```js
await page.getByLabel("Match").waitFor();
// The match starts only once its models are ready (Plan 4): wait on the sim, not the clock.
await page.waitForFunction(() => (window.__smashDebug?.frame ?? 0) >= 70, undefined, { timeout: 30000 });
```

(`page.getByLabel("Match").screenshot()` now photographs the three stacked canvases together.)

- [ ] **Step 2: Run the lab's tests and its e2e**

Run: `pnpm vitest run src/app/anim && PORT=3107 pnpm test:e2e e2e/anim.spec.ts`
Expected: PASS (the e2e still finds the 2D "Contact sheet" by its exact label; the model sheet is "Model sheet").

- [ ] **Step 3: Photograph one** (dev server up)

Run: `node scripts/animsheet.mjs attack --move ftilt --view 3d`
Expected: `Animation lab — ftilt (25 frames)` and the path `…/test-results/anim/anim-mario-attack.png` (verified in scratch: 25 cells, the forward tilt's hitboxes on frames 4–6 over Mario's real limbs); `git status --short` shows nothing new. Read the PNG.

- [ ] **Step 4: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add super-smash/src/app/anim/Lab3D.tsx super-smash/src/app/anim/page.tsx super-smash/scripts/animsheet.mjs super-smash/scripts/fightsheet.mjs
git commit -m "super-smash: the animation lab draws the 3D model with the sim's hit- and hurtboxes" -m "A model sheet per action at its true length, posed by the match's own drawnPose, with this frame's hitboxes and hurtboxes from the bake; animsheet --view 3d photographs it; fightsheet waits on the sim before capturing." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: e2e — stand-in fallback, lost context, resize and DPR, the four-fighter budget

**Files:**
- Create: `super-smash/e2e/render3d.spec.ts`

**Interfaces:** Consumes `window.__smashRender.info()` and `window.__smashDebug.frame` (Task 20), `startFromTitle`, `startMatch`, `waitForMatch` (`e2e/helpers.ts`), the select screen's "Add a player" button.

- [ ] **Step 1: Write the spec** — `e2e/render3d.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

import { startFromTitle, startMatch, waitForMatch } from "./helpers";

/**
 * The 3D renderer in a real browser (Plan 4, Task 22). Every assertion reads
 * `window.__smashRender.info()` (draw calls, triangles, buffer size, context
 * state, what each fighter was drawn with) or `__smashDebug.frame` — pixels are
 * opaque to a test, and a frame counter that keeps climbing is the honest
 * signal that the match survived.
 */

interface RenderInfo {
  calls: number;
  triangles: number;
  lost: boolean;
  buffer: { width: number; height: number };
  fighters: ("glb" | "standIn" | "loading")[];
}

const info = (page: Page) =>
  page.evaluate(() => (window as unknown as { __smashRender?: { info(): RenderInfo } }).__smashRender?.info() ?? null);
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __smashDebug?: { frame: number } }).__smashDebug?.frame ?? -1);

async function framesAdvance(page: Page): Promise<void> {
  const before = await frame(page);
  await expect.poll(() => frame(page), { timeout: 5000 }).toBeGreaterThan(before + 30);
}

test("plays with stand-ins when the models 404 (Review Focus #1)", async ({ page }) => {
  await page.route("**/models/**", (route) => route.fulfill({ status: 404, body: "" }));
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  await startMatch(page);
  await expect.poll(async () => (await info(page))?.fighters ?? []).toEqual(["standIn", "standIn"]);
  await framesAdvance(page);
  await expect(page.getByText("THE MATCH COULD NOT START")).toHaveCount(0);
  expect(warnings.some((w) => w.includes("stand-in"))).toBe(true);
});

test("survives WEBGL_lose_context and comes back (Review Focus #2)", async ({ page }) => {
  await startMatch(page);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-layer="world"]')!;
    const ext = canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
    ext.loseContext();
    (window as unknown as { __restore: () => void }).__restore = () => ext.restoreContext();
  });
  await expect.poll(async () => (await info(page))?.lost).toBe(true);
  await framesAdvance(page); // the sim runs on without a picture
  await page.evaluate(() => (window as unknown as { __restore: () => void }).__restore());
  await expect.poll(async () => (await info(page))?.lost).toBe(false);
  await expect.poll(async () => (await info(page))?.calls ?? 0).toBeGreaterThan(0);
  await framesAdvance(page);
  await expect(page.getByText("THE MATCH COULD NOT START")).toHaveCount(0);
});

test("follows a resize and a DPR change (Review Focus #3)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await startMatch(page);
  await expect.poll(async () => (await info(page))?.buffer.width).toBe(1280);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(async () => (await info(page))?.buffer).toEqual({ width: 1600, height: 900 });
  await context.close();

  const hiDpi = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page2 = await hiDpi.newPage();
  await startMatch(page2);
  // Capped at the game's 1920×1080 however dense the display.
  await expect.poll(async () => (await info(page2))?.buffer).toEqual({ width: 1920, height: 1080 });
  await hiDpi.close();
});

test("stays inside the draw-call and triangle budget with four fighters (Review Focus #5)", async ({ page }) => {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();
  await page.getByLabel("Stages").getByRole("button").first().click();
  await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();
  await page.getByRole("button", { name: "Add a player" }).click();
  await page.getByRole("button", { name: "Add a player" }).click();
  const roster = page.getByLabel("Fighters").getByRole("button");
  for (let i = 0; i < 4; i++) await roster.nth(i).click();
  await page.getByRole("button", { name: /ready|fight/i }).first().click();
  await waitForMatch(page);
  await expect.poll(async () => (await info(page))?.fighters.length).toBe(4);
  if (process.env.REQUIRE_MODELS === "1") {
    // Against a build with `pnpm models`: every fighter must be its real model.
    await expect.poll(async () => (await info(page))?.fighters).toEqual(["glb", "glb", "glb", "glb"]);
  }
  let worst = { calls: 0, triangles: 0 };
  for (let i = 0; i < 20; i++) {
    const now = (await info(page))!;
    worst = { calls: Math.max(worst.calls, now.calls), triangles: Math.max(worst.triangles, now.triangles) };
    await page.waitForTimeout(250);
  }
  expect(worst.calls).toBeGreaterThan(0);
  expect(worst.calls).toBeLessThan(100);
  expect(worst.triangles).toBeLessThan(500_000);
});
```

- [ ] **Step 2: Run it**

Run: `PORT=3107 pnpm test:e2e e2e/render3d.spec.ts`
Expected: 4 passed (verified in scratch against stand-ins: 4 passed in 22 s, and 8/8 on a `--repeat-each=2` rerun; one cold-start timeout in "follows a resize and a DPR change" on the very first full-suite run is Plan 1's single-rerun case).

- [ ] **Step 3: Run it against the real models** (required whenever Task 8 ran — this is the only test that counts the real glbs' draw calls)

Run: `pnpm models:check && REQUIRE_MODELS=1 PORT=3107 pnpm test:e2e e2e/render3d.spec.ts`
Expected: 4 passed, the budget test now insisting every fighter is its glb. The ceiling it can reach is 4 × 12 primitives + 7 (stage platforms, two effect batches, shadows) = 55 calls, which `renderer3d.test.ts` already counts; a failure on calls ≥ 100 means a glb got past `glb.mjs` with more than 12 primitives — fix the export, never the budget.

- [ ] **Step 4: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && PORT=3107 pnpm test:e2e`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add super-smash/e2e/render3d.spec.ts
git commit -m "super-smash: e2e for the 3D layer — models 404, lost context, resize/DPR, four-fighter budget" -m "Each reads __smashRender.info() and the sim's frame counter: the match plays on stand-ins when every glb 404s, survives WEBGL_lose_context and repaints on restore, follows a resize and a 2x display capped at 1080p, and stays under 100 draw calls and 500k triangles with four fighters (REQUIRE_MODELS=1 insists on real glbs)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: 3D by default; remove the dead Canvas2D fighter path; record the decision (D57)

The 3D path has been the only one the play page uses since Task 20. What the 2D renderer still carries for fighters is now dead: the full-body figure in a match, its rim pass and silhouette debug mode, dodge afterimages, the platforms, the 2D shield, and the lab's 2D cells. They go. What stays: `src/render/poses/**` and `chars/*/poses.ts` (the animation source), `chars/*/fx.ts` (move effects and projectile painters, still drawn on the overlay), `drawFigure` and the rigs (the HUD portraits and stock icons are drawn from them, spec "HUD unchanged"), `rigKit`, `fxKit`, the camera, the HUD and the overlay effects.

**Files:**
- Delete: `super-smash/src/render/swing.ts`, `super-smash/src/render/swing.test.ts` (the 2D swing arcs, unused since Task 20 stopped drawing them over the 3D world)
- Modify: `super-smash/src/render/renderer.ts`, `super-smash/src/render/renderer.test.ts`, `super-smash/src/render/overLayer.test.ts`, `super-smash/src/render/overlay3d.test.ts`, `super-smash/src/render/vfx.ts`, `super-smash/src/render/vfx.test.ts`, `super-smash/src/render/stageArt.ts`, `super-smash/src/render/characterArt.ts` (only the exports that become unused), `super-smash/src/render/poses/shield.ts` (doc comment that names `drawShield`), `super-smash/src/render/chars/kirby/fx.ts` (two comments that cite `render/swing.ts`), `super-smash/src/game/matchRunner.ts` (`debugSilhouette`, `world3d`), `super-smash/src/app/anim/page.tsx`, `super-smash/src/app/anim/lab.test.ts`, `super-smash/src/app/anim/Lab3D.tsx` (its sheet becomes "Contact sheet"), `super-smash/scripts/animsheet.mjs`, `super-smash/e2e/anim.spec.ts`, `super-smash/docs/character-art.md`, `super-smash/docs/screenshots/match.png`, `super-smash/docs/screenshots/match-2.png` (recaptured), `super-smash/DECISIONS.md`, `super-smash/README.md`

**Interfaces:** `RenderState.world3d` and `debugSilhouette` are removed — the overlay is the only 2D mode; `render()` always clears and returns `OverlayResult`; `MatchRunnerOptions.presenter` stays optional (unit tests run the runner without a GPU), but the play page always passes one.

- [ ] **Step 1: Find everything that touches the dead path**

Run: `grep -rnE "drawAfterimages|drawPlatforms|platformOffsetX|drawShield\b|debugSilhouette|state\.world3d|world3d\?:|world3d: |drawCell|ghost\(|drawSwingArc|swingArcFor" src e2e scripts | cut -d: -f1 | sort | uniq -c`
Expected (measured in scratch on the Task 22 tree, pre-Plan-1 page; Plan 1's page may add `world3d` hits in `app/play/page.tsx` only if it names the flag):

```
   4 src/app/anim/lab.test.ts
   6 src/app/anim/page.tsx
   5 src/game/matchRunner.ts
   1 src/render/characterArt.ts
   4 src/render/overlay3d.test.ts
   2 src/render/overLayer.test.ts
   2 src/render/poses/shield.ts
   2 src/render/renderer.test.ts
  19 src/render/renderer.ts
   3 src/render/stageArt.ts
  18 src/render/swing.test.ts
   3 src/render/swing.ts
   8 src/render/vfx.test.ts
   1 src/render/vfx.ts
```

(The pattern names the flag's *uses* — `state.world3d`, `world3d?:`, `world3d: ` — not the word, which `src/game/world3d.ts`, `useWorld3d` and `import("@/game/world3d")` keep.)

- [ ] **Step 2: Delete, by symbol**
- `render/renderer.ts`: delete `drawAfterimages`, the swing-arc loop and its `./swing` import, the `world3d` field and every `state.world3d` branch (keep the overlay side of each: `clearRect`, no background or platforms, no figure, no shield, no port ring, no swing arc, `WORLD3D_PARTICLES` always skipped, `const anchor = state.anchors?.[f.port] ?? null;`), `debugSilhouette` and `mode`, and the `drawFigure`/`rimWidth`/`params`/`propAnimFor` block in `drawOneFighter` (keep `drawMoveFx` with its `over` paints, `drawFinalSmashAura`, `drawDizzyStars`, the anchored port tag, and the `visualHeight` fallback for a fighter with no anchor — no bake).
- `render/swing.ts`, `render/swing.test.ts`: delete (`git rm`). In `render/chars/kirby/fx.ts` the two comments that say "`render/swing.ts`" now say "the 2D swing arc (removed in Plan 4)". Remove imports that become unused (`drawPlatforms`, `drawShield`, `drawFigure`, `rimWidthFor`, `propAnimFor`, `resolvePalette`, `squashFor`, `blendedPose`, `clipFrameFor`, `samplePoseForFighter`, `poseSpinFor`, `rotationPivot`, `resolve`-side types) — `pnpm lint` names each.
- `render/stageArt.ts`: delete `drawPlatforms`, `drawMainPlatform`, `drawSoftPlatform`, `MAIN_DEPTH` and `platformOffsetX` (the 3D stage uses `platformCentreX`); keep `drawBackground`, `drawBlastZone`, `themeFor`, `stagePaintFor`, `StagePaint`.
- `render/vfx.ts`: delete `drawShield` (the 3D bubble is `shieldLook`) and the afterimage tracking and state (`Afterimage`, `VfxState.afterimages`, `trackAfterimages` and its call in `stepVfx`) — Ultimate draws no dodge afterimages and nothing else reads them.
- `game/matchRunner.ts`: delete `debugSilhouette` from the options, the destructuring and `RenderState`, and `world3d: presenter !== null,` from `RenderState` (keep `anchors`).
- `render/overlay3d.test.ts`: drop the `world3d` argument of `stateWith` (and the field), and delete "draws no 2D swing arc over a 3D sword" and "keeps the 2D rig's heights and swing arcs in the 2D renderer" (their subject is gone) with the `./swing` mock and import; "puts port tags, dizzy stars and the Final Smash aura over the model's head bone" remains.
- `app/anim/page.tsx`: delete the 2D `Playback` and `Contact sheet` canvases, their two effects, `drawCell`, `ghost`, the onion-skin checkbox and the 2D-only imports; keep `Options`, `fighterAt`, `moveFor`, `groundedFor`, `usesMoveFor`, `verticalFor`, `lengthOf`, the controls and `<Lab3D>`. In `Lab3D.tsx` rename the sheet's `aria-label` to `"Contact sheet"` and its caption to "contact sheet — …".
- Tests: in `renderer.test.ts`, `overLayer.test.ts`, `vfx.test.ts` and `lab.test.ts` delete exactly the tests whose subject was deleted (each one fails to compile or import once its symbol is gone) and keep every other; a test of the overlay that drew a figure becomes one that asserts no figure is drawn (`createMockContext` sees no `lineCap = "round"` capsule calls during a match frame — `countCapsules` in `mockContext.ts`).
- `scripts/animsheet.mjs`: drop `--playback` and `--view`; it photographs "Contact sheet" (the 3D one), waiting for its status line as in Task 21.
- `e2e/anim.spec.ts`: unchanged text ("Contact sheet") now finds the 3D sheet; its "every fighter's rig survives the same clip" loop also waits for `/contact sheet — (model|stand-in)/` before asserting no page error.

- [ ] **Step 3: Gate, build, e2e**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && PORT=3107 pnpm test:e2e`
Expected: exit 0. The Step 1 grep now prints nothing, and `pnpm vitest run src/app/chunkSplit.test.ts` still passes (6 tests).

- [ ] **Step 3b: Recapture the screenshots** (decided: regenerate — "Decisions taken" 6). With `pnpm models` built (`pnpm models:check` passes) and the dev server up:

Run: `CAPTURE=1 PORT=3107 pnpm test:e2e e2e/screenshots.spec.ts && git -C "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates" status --short super-smash/docs/screenshots`
Expected: 7 passed; `match.png` and `match-2.png` now show the SSBU models under the HUD (renders of the models, not the ripped files). Read both. Commit only those two: `title.png` and `character-select.png` also change between any two captures (animated backgrounds), and this plan does not change those screens — restore them with `git -C "/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates" checkout -- super-smash/docs/screenshots/title.png super-smash/docs/screenshots/character-select.png`.

- [ ] **Step 4: Documentation** — `docs/character-art.md`: replace its "how a fighter is drawn" sections with: the model pipeline (`pnpm models`, what is and is not committed), the retarget rule (2D angles drive SSBU bones in the side plane; spine/legs/feet keep the bind stance, arms hang), the bake (`UPDATE_BAKE=1`, when to regenerate), the lab's model sheet with hit/hurt boxes, and "a clip edit is a gameplay edit now: re-bake, re-run `reach.test.ts`". `README.md` (Architecture): the three canvases, `render3d/`, the bake, `pnpm models`, and "without `pnpm models` fighters are stand-ins". Append to `DECISIONS.md`:

```markdown
## D57 — The fighters are SSBU's models, the animation is ours, and the bones are baked

**Decision.** David-Smash draws its fighters with their SSBU models (Worldblender's Blender
re-exports, fetched and built locally by `pnpm models`, never committed), animated by the
replica's own 2D pose clips retargeted onto each SSBU skeleton, and the sim reads those same
bones from integer tables baked at build time (`public/bake/roster.bin.gz`).

**Why the clips and not SSBU's animations.** SSBU's animations are game files; the clips are
ours, already timed to every move's hitboxes (D34) and reviewed one by one (D41, D44). Driving
SSBU bones from them keeps the animation source the project owns and has tuned, and the side
view only ever shows the side plane — which is the plane the clips are drawn in.

**Why bake.** Research R§2 named the root cause of "the attacks don't look like anything": the
animation and the hitboxes were two sources of truth. Now one function — clock, clip sample,
retarget, root transform — runs at build time into Q12 integers for the sim and at run time into
three.js for the screen, and a test holds every bone of every frame of every motion to the bake's
1/256-unit quantum. Hurtboxes, the ECB's height and width, and the limb-bone hitboxes of the
published scripts all hang off those bones.

**What it costs.** A limb hitbox goes where our clip puts the limb, not where Ultimate's
animation would; `reach.test.ts` lists every move whose reach moved, and each was reviewed. A
clip edit is now a gameplay edit and needs a re-bake. Hurt capsule sizes are derived from mesh
weights and are UNVERIFIED. The bake must match on both peers; its SHA-256 is the engine
fingerprint they compare.

**Sizes are SSBU's.** Hurtboxes, the ECB and limb reach come from the models' bones, so bodies
are the models' (Donkey Kong 26.3 units tall standing, was 15.0); the old `attributes.width` /
`height` box is only the no-bake fallback. `src/game/hurt.allow.json` lists every fighter's old
box beside its bones' numbers, regenerated and reviewed on any change. The ECB's width is the
pelvis capsule's (the chest made DK's 21.6 units wide); its bottom stays at the feet, in the air
too (UNVERIFIED). The camera still frames every fighter with at least 16.7 units of headroom.

**Built without Blender where it matters.** The skeletons, hurt capsules and bake come from a
stdlib-only reader of the `.blend` files (`scripts/models/skeleton_from_blend.py`), so the sim,
the bake and every test need neither Blender nor the model cache; Blender only exports the glbs,
and its dump is cross-checked against the reader's. Which meshes are the fighter is an exhaustive
per-fighter list (`scripts/models/meshes.json`), not a name pattern.

**One clock.** The bake bakes the game's fighters (limb-bone scripts on), and the renderer draws
on the sim's clock — even where the 2D renderer restarts a clip, as on a mid-fall fast fall — so
hitboxes, hurtboxes and drawn limbs agree; D42's four-frame fade is the one cosmetic exception.
`ENGINE_RULES_VERSION` is 4, and the online fingerprint covers the bake and the limb-bone slots.

**Settled with it.** Size modifiers scale limb offsets and hurt capsules with each fighter's
`scale`, not ATTACK sizes (SmashWiki's draft "Size modifiers" article, moderate confidence:
UNVERIFIED). No bloom, no facial-expression swaps, and the shield stays where Plan 3 put it
rather than on a baked bone. The overlay hangs port tags, move effects, dizzy stars and the Final
Smash aura on each model's head capsule, and no longer draws 2D swing arcs. three.js loads in its
own chunk after `/play` mounts. A model that fails to load is a stand-in for that match only.

**What it is not.** No ripped file is ever committed (spec §3.1): only bone names, bind matrices,
capsule sizes and SHA-256s; the guard test refuses any tracked file whose name, or whose size and
hash, is a manifest file's. A checkout without `pnpm models` plays with capsule stand-ins.
```

- [ ] **Step 5: Gate again and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0.

```bash
git add super-smash/src/render super-smash/src/game/matchRunner.ts super-smash/src/app/anim super-smash/scripts/animsheet.mjs super-smash/e2e/anim.spec.ts super-smash/docs/character-art.md super-smash/docs/screenshots/match.png super-smash/docs/screenshots/match-2.png super-smash/DECISIONS.md super-smash/README.md
git commit -m "super-smash: 3D by default; remove the dead Canvas2D fighter path (D57)" -m "The match figure, its rim and silhouette modes, afterimages, 2D platforms, the 2D shield and the lab's 2D cells are gone; the poses, move effects, HUD portraits and overlay stay. D57 records why the fighters are SSBU's models driven by our clips with baked bones." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git status --short` must show nothing under `public/models/` or `.model-cache/` (Task 1's test).

- [ ] **Step 6: STOP: ask David for go to deploy.** The deploy (Plan 1 Task 24's `pnpm run deploy`) now runs `models:check` first and uploads `out/models/*.glb` from local disk. Say: "Plan 4 is ready to ship: the eight SSBU fighter models (each under 25 MiB; their sizes are the eight lines `pnpm models` printed) are uploaded from my machine to the Worker's static assets, never committed. Deploy?" On go, run Plan 1 Task 24's deploy steps, then `SMASH_URL=https://david-smash.leaders-game.workers.dev REQUIRE_MODELS=1 pnpm test:e2e e2e/render3d.spec.ts`.

---

## Self-review

**Spec coverage (§2, §3.1, §3.2 phase 4, §3.4 budget; the brief's eight items).**
1. Pipeline (fetch → Blender export → optimise → `public/models/`, git-ignored, hashes only committed, `pnpm models`, deploy check) → Tasks 1, 5–8; the skeletons the sim reads need no Blender (Task 6); Plan 1 Task 24's `deploy` runs `models:check` (Task 8 Step 4).
2. Retargeting (16 2D bones → SSBU chains, screen-normal rotations from a per-fighter bind calibration, facing as a turn, `spin`) → Tasks 2–4, 17.
3. Deterministic bake (every fighter × motion × frame on the game's fighters; pure TS FK; Q12; committed; registered through `GAME_SIM_CONTEXT`; renderer == bake test, on the sim's clock) → Tasks 9–11, 13, 17 (`fighterPose.test.ts`).
4. Limb-bone `game_` scripts switched on, reconcile entries removed, golden regenerated with reasons, the online fingerprint covering them → Task 13 (and Task 12 for the trace).
5. Per-bone hurtboxes (UNVERIFIED, from mesh weights; rubendal publishes none) and an ECB from bones, at SSBU's sizes with a reviewed ratchet and a camera check → Task 12.
6. three.js renderer (pinned 0.186.1, its own chunk; side camera from `camera.ts`; GPU skinning; toon + rim with the c00 colour maps; blob shadows, no bloom, inside budget with joined glbs; 3D stage from platform rects; sparks, the shield bubble that knows its HP, KO blasts as instances; HUD unchanged as overlay, anchored to the models' heads; position interpolation as before; lazy, verified glbs with loading screen and per-match stand-in fallback; dispose) → Tasks 14–20.
7. `/anim` and the capture scripts in 3D; e2e and a perf budget test against real glbs; `docs/screenshots` recaptured → Tasks 21–23.
8. Dead Canvas2D fighter paths removed after 3D is default; `poses/**` kept → Task 23.

**Placeholder scan.** Every code block that names a file is the file's full text from the verified scratch tree (or, for edits to Plans 1–3 code, the exact replacement by symbol). Every artefact a command produces from the real inputs is given exactly — the skeletons by SHA-256, `hurt.allow.json`, `limb.json` and `reach.allow.json` in full, both bake digests and sizes, the reconcile deletion count, the reader's per-fighter lines — so the executor compares rather than trusts. No commit message carries a `<n>`-style blank. The two places that depend on code this plan has not seen are named as such: Plan 1's final play page and online handlers (Task 20 Steps 7–8, by symbol) and the Blender-only numbers (glb sizes and triangles, Task 8 Step 6).

**Type consistency.** `BonePose`/`BoneTable` are Plan 2's final (out-parameter `pose`); `BakeTables.bones` wraps Plan 2's `layeredBoneTable(bakedBoneTable(…), LEGACY_BONE_TABLE)` with the bake's digest as its fingerprint; `EngineRules`/`engineFingerprint(ctx, rules)` are Plan 3's, with `GAME_ENGINE_RULES` made mutable as `GAME_SIM_CONTEXT` is. `SimContext.bake` is optional, so every Plan 1–3 context compiles unchanged. `Hitbox.x2/y2`, `CollisionOutcome.wall` (a side number) and the glancing-blow depth are Plan 3's.

**Determinism.** The engine side (`poseClock`, `bakeCodec`, `bakeTables`, `hurtboxes`, `scriptBones`) uses integers, `Math.floor`/`max`/`min` on integers and Plan 2's `jumpRiseSpeeds`; `layering.test.ts` passes with its forbidden list unchanged (verified). Float maths (retarget, FK) runs only at build time in `render3d/bake/` and at run time in the renderer; the `.blend` reader is Python at build time and its output is committed.

**Review Focus placement.** #1 Tasks 16, 19, 22; #2 Tasks 19, 22; #3 Tasks 14, 19, 22; #4 Task 17; #5 Tasks 8, 19, 22.

## Task list

1. Keep every Nintendo file out of git, before any is downloaded
2. Rigid maths and the skeleton file format
3. Retargeting the 2D clips onto an SSBU skeleton
4. Forward kinematics and the side-plane projection the sim reads
5. Fetch the models at a pinned commit, with SHA-256 checks; guard every manifest file
6. Read the skeletons out of the .blend files without Blender, and commit them
7. Install Blender 5.2.2, portable, inside the model cache (STOP: ask David)
8. Export the glbs with Blender, joined per texture; verify, publish and guard the deploy
9. The pose clock — which baked frame a fighter's bones are on, in integers
10. The bone bake — every motion, every frame, every bone the sim reads
11. Load the bake and install it in the game's context
12. Per-bone hurtboxes, the ECB from bones, at SSBU's sizes
13. Switch on the published limb-bone `game_` scripts
14. three.js, and a side camera framed by the existing 2D camera
15. The stage in 3D, generated from the sim's platforms
16. Load fighter models lazily, never fatally
17. A fighter in 3D — posed exactly as the bake, turned to face, flashed and blinked
18. Sparks, KO blasts and shields as instanced 3D effects
19. The 3D presenter — scene, lights, blob shadows, context loss, resize, dispose
20. The match in 3D — overlay mode, the runner's presenter, the play page, the loading screen
21. The animation lab and the capture scripts in 3D
22. e2e — stand-in fallback, lost context, resize and DPR, the four-fighter budget
23. 3D by default; remove the dead Canvas2D fighter path; record the decision (D57) (deploy STOP at the end)

## Decisions taken (planner's calls after review, confirmed when David approves this plan) and how the plan applies them

1. **Sizes:** adopt SSBU's model sizes — hurtboxes, ECB and reach from bones; legacy body sizes retired to the no-bake fallback (Task 12, `hurt.allow.json`; D57).
2. **Skeletons without Blender:** a stdlib SDNA reader is the source of bones and weights; Blender only for the glbs (Tasks 6–8).
3. **Blender install location:** portable, in `.model-cache/tools/`, behind the STOP (Task 7).
4. **Committed skeletons and bake:** yes (Tasks 6, 10, 13).
5. **ECB in the air:** the bottom stays at the feet — UNVERIFIED (Task 12).
6. **Screenshots in `docs/`:** regenerate (Task 23 Step 3b).
7. **Bloom:** no. **Facial expressions:** no (the neutral face only, `meshes.json`). **Shield on a baked bone:** no (Plan 3's bubble stays).
8. **Fighter scale:** limb offsets and hurt capsules scale with `FighterParams.scale`; ATTACK sizes do not (SmashWiki's draft "Size modifiers" article, moderate confidence — UNVERIFIED; D57).

## Open questions (for David)

1. **Donkey Kong's standing size.** At SSBU's size and his model's own spine, DK stands 26.3 units tall with a 4.3-unit-wide pelvis (legacy 15.0 / 3.2), and his limb-bone `fair`/`nair` reach 26.5/25.6 units (legacy 14.0/11.0) — the largest changes in `hurt.allow.json` and `reach.allow.json`. This is what "adopt SSBU sizes" means for him; confirm, or ask for a per-fighter spine lean override (`RETARGET_OVERRIDES`) that would hunch him lower.
2. **The stray capture in the repo.** `super-smash/anim-mario-land.png` (a 2D lab capture, ours, not ripped) is tracked at the package root because `animsheet.mjs` used to write there; Task 21 moves the default to `test-results/anim/`. Delete the file?
3. **Kirby's hurt bones.** His mesh is weighted to `Body` (under `Head`) and to `FootL/R` under `KneeL/R`, so his capsules are one body, two per arm, one per leg (7), not the humanoid 11. Fine as the UNVERIFIED stand-in for Ultimate's?

## Risks

- **Blender's export may not match the reader.** The reader's numbers are committed; Task 8's cross-check fails loudly per bone, kept mesh and capsule if Blender's dump differs, and `glb.mjs verify` refuses a glb whose joints are more than 0.01 units from the dump. `bpy.ops.object.join` needs an object context in background mode; Task 8 Step 5 names the override if it complains.
- **Materials.** The importer's "basic materials" may mix several textures per material (eyes use two UV maps). The export takes the largest colour map per material and merges materials on the same texture; eyes may look flat or mis-mapped. The lab shows each fighter's face; fix per material in `export_gltf.py` if needed.
- **SSBU sizes change the game.** Every fighter's body grew (Kirby's ECB is 4.3 wide, Pikachu's 3.4), so walls, ledges, platforms and hits all meet bigger bodies; the golden trace records it and `hurt.allow.json` lists it, but play-feel has not been judged by a human. The ECB width uses the pelvis (UNVERIFIED); the chest was rejected as far too wide.
- **Reach drift.** Limb hitboxes follow our clips at SSBU proportions, not Ultimate's animations; 27 switched-on moves moved more than 3 units or 30% (`reach.allow.json`), each needing a human look. The CPU's `meleeReachFromDef` still reads legacy hitbox offsets (Plan 5 replaces it).
- **Hurt capsule sizes are UNVERIFIED.** A capsule that swallows a prop (cape, tail) makes a fighter easier to hit. `NOT_BODY` excludes held items, swords, tails and `Throw`; `hurt.allow.json` makes every size change a reviewed diff.
- **D42's four-frame fade** draws a body that leads the sim's hurtboxes slightly during a clip change (never during an attack: attacks do not fade). Accepted and documented in `fighterPose.ts`; the larger fast-fall mismatch is fixed (the 3D limbs follow the sim's clock).
- **Plan 1 text drift.** Task 20's play-page and online edits are written against Plan 1 Tasks 20–21 and Plan 2 Task 27 as those plans print them; if their executors changed them, apply the same edits by symbol. The logic was verified end to end on the pre-Plan-1 page; the online preload and the guest's async start were not run.
- **Bundle size.** three.js (~170 KB gzipped) loads only after `/play` or `/anim` mounts (`chunkSplit.test.ts`); the bake (1.58 MB gzipped) once per page that needs it. The menus are unaffected.
- **Headless WebGL in CI.** Playwright's Chromium runs WebGL through SwiftShader/ANGLE (verified locally on macOS arm64). On a CI image without it the e2e would fail at the first 3D test, loudly. The resize e2e saw one cold-start timeout on a first run (Plan 1's single-rerun rule covers it).
- **Python versions.** The reader was run with Python 3.15.0; it uses only `struct`, `json`, `math` and `re`, and the skeleton SHA-256s in Task 6 detect any drift.

## Interfaces for later phases

Exact definitions Plan 5 (specials, Final Smash, CPU, controls) builds on, as committed by the end of this plan.

### The bake and the pose clock (`src/engine/acmd/`)

```ts
// poseClock.ts
export type ClockKind = "script" | "once" | "scaled" | "loop" | "idle" | "paced";
export interface MotionClock { readonly kind: ClockKind; readonly frames: number }
export const SCALED_FRAMES = 60;
export const STRIDE_UNITS = 36;
export function playsMoveScript(action: ActionState): boolean;
export function statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling">): MotionKind; // "status_<action>", "_aerial", "_fast"
export const VARIABLE_LENGTH_ACTIONS: ReadonlySet<ActionState>;
export function statusDuration(f, def?: FighterDef): number | undefined;
export type ClockLookup = (fighterId: string, motion: MotionKind) => MotionClock | undefined;
export interface PoseIndex { readonly motion: MotionKind; readonly frame: number }
export function poseIndexOf(def: FighterDef, f: ClockedFighter, globalFrame: number, clockOf: ClockLookup): PoseIndex | null;

// bakeCodec.ts / bakeTables.ts
export const BAKE_QUANTUM = 16;
export interface BoneHurtbox { readonly bone: BoneName; readonly x1: number; readonly x2: number; readonly r: number }
export interface BakedFighter { readonly bones: BakedFighterBones; readonly clocks: Readonly<Record<MotionKind, MotionClock>>; readonly hurt: readonly BoneHurtbox[] }
export function encodeBake(fighters: readonly BakedFighter[]): Uint8Array;
export function decodeBake(bytes: Uint8Array): BakedFighter[];
export interface BakeTables {
  readonly bones: BoneTable; // fingerprint = first 8 hex of the bake's SHA-256
  clock(fighterId: string, motion: MotionKind): MotionClock | undefined;
  hurtboxes(fighterId: string): readonly BoneHurtbox[] | undefined;
  readonly fingerprint: string;
}
export const LEGACY_BAKE: BakeTables;

// hurtboxes.ts — sizes are the models' (D57); src/game/hurt.allow.json lists them
export function localHurtboxes(def, f, globalFrame, bake, bones?): Capsule[] | null;
export function fighterHurtboxes(def, f, globalFrame, bake, bones?): Capsule[] | null;
export const ECB_BODY_BONES: ReadonlySet<string>; // "hip", "body" (Kirby)
export function restEcb(def, bake, bones?): Ecb | null; // standing ECB: the fighter's size
export function bakedEcb(def, f, globalFrame, bake, bones?): Ecb | null;
// src/game/simContext.ts (Plan 3's, extended)
export const GAME_ENGINE_RULES: { version: number; activeSlots: Record<string, readonly MoveSlot[]> }; // version 4; + LIMB_SCRIPT_SLOTS once installBake ran
export function mergeSlots(a, b): Record<string, readonly MoveSlot[]>;
// src/render3d/skeletons/hurtBones.ts
export function hurtBonesFor(fighterId: string): { readonly head: string; readonly bones: readonly string[] };
// simulate.ts
interface SimContext { readonly bones?: BoneTable; readonly bake?: BakeTables /* Plan 4 */ }
```

**Adding a motion to the bake (Plan 5: counters, reflectors, wall jump, footstool, Final Smash).**
- *A new status:* follow Plan 2's four-part rule (an `ActionState` member, a `StatusKind`, a `FighterStatus`, an `ALL_STATUSES` entry). `statusMotion` names its motion `status_<action>` automatically and `statusMotionSpecs()` bakes it. Give it a clip: a case in `poseNameFor` (`render/poses/timing.ts`) naming an existing or new `PoseName` (a new clip is a file in `render/poses/` plus a `POSE_LIBRARY` entry, or a fighter's own in `chars/<id>/poses.ts`). If its length is a constant, add the case to `statusDuration`; if it varies per frame of play, also add the action to `VARIABLE_LENGTH_ACTIONS`. Then `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts` and `UPDATE_GOLDEN=1 …`.
- *A new or changed move:* its motion is its active script's on the game's fighter (`gameScriptFor(withLimbScripts(def), slot).motion`) at the script's motion frames; its clip is `SLOT_POSE[slot]` (with the fighter's override). A script that names a bone the committed skeleton lacks makes `bakeFighter` throw naming it; add the bone to the skeleton by re-running Task 6 Step 6 (it keeps every bone any reference script names). Re-bake, then run `limb.test.ts`, `reach.test.ts` and `hurtboxes.test.ts` (regenerate with `UPDATE_LIMB=1` / `UPDATE_REACH=1` / `UPDATE_HURT=1` and review). A move switched on in a new script table must also reach `GAME_ENGINE_RULES.activeSlots`, or two builds that differ in it share a fingerprint.
- *A Final Smash cinematic* that moves a fighter outside the side plane: the bake only stores the side-plane projection; a cinematic camera belongs to the presenter (below), not the bake.

### The 3D layer (`src/render3d/`)

```ts
// renderer3d.ts
export interface Presenter3D {
  readonly ready: Promise<void>;
  paint(rs: RenderState, camera: Camera, alpha: number, hidden: readonly boolean[]): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  info(): RenderInfo; // { calls; triangles; lost; buffer; fighters }
  dispose(): void;
}
export function createRenderer3D(opts: Renderer3DOptions): Presenter3D;

// fighter3d.ts — attach anything to a limb
export interface Fighter3D {
  readonly placement: Group;          // world-space; add props as children of a bone found by name
  readonly kind: "glb" | "standIn";
  update(frame: FighterFrame): void;
  bonePosition(name: string, out: Vector3): boolean; // world position of an SSBU bone this frame
  dispose(): void;
}

// vfx3d.ts — instanced effects
export const SPRITE_KINDS: ReadonlySet<ParticleKind>;   // add a kind here (and to WORLD3D_PARTICLES) to move it to 3D
export interface ShieldLook { readonly x: number; readonly y: number; readonly radius: number; readonly alpha: number; readonly colour: string }
export function shieldLook(f, def: FighterDef, parryFlash: number): ShieldLook | null;
export interface Vfx3D { readonly group: Group; update(v: VfxState, shields: readonly (ShieldLook | null)[]): void; counts(): { sprites: number; shields: number }; dispose(): void }

// anchors.ts — where the overlay hangs things on a fighter (pure, no three)
export function overlayAnchor(def, f, globalFrame, bake): { headX: number; headTop: number } | null;

// budget.ts
export const MAX_DRAW_CALLS = 100, MAX_TRIANGLES_PER_FRAME = 500_000, MAX_FIGHTER_PRIMITIVES = 12;

// models/loader.ts
export interface ModelCache { get(id): Promise<LoadedModel>; preload(ids): Promise<void>; status() } // a failed model retries next match
export function verifyModelBytes(bytes: ArrayBuffer, entry: ModelIndexEntry): Promise<void>;

// camera3d.ts
export function sideCameraPose(cam, fovDeg?): SideCameraPose;   // Final Smash cinematics: override the pose for N frames
export function applySideCamera(three: PerspectiveCamera, cam): void;

// fighterPose.ts — the one pose function the match, the lab and the bake share
export function drawnPose(inputs: FighterPoseInputs, f: FighterState, frame: number, blends: PoseBlend[] | null): DrawnPose;
export function bakedPoseAt(inputs: FighterPoseInputs, index: PoseIndex): DrawnPose;
```

**Special and Final Smash VFX (Plan 5).** Three routes, cheapest first: (1) a 2D painter in `chars/<id>/fx.ts` keyed by move slot still draws on the overlay, framed by the same camera and sized by the model's head anchor (Kirby's Stone, Samus's charge, Link's hookshot all keep working); a painter that wants to sit on a limb can read the limb's world position from the presenter via a new `Presenter3D.bonePosition(port, bone, out)` that forwards to `Fighter3D.bonePosition`. (2) A particle kind added to `SPRITE_KINDS` and `WORLD3D_PARTICLES` moves into the instanced 3D sprites at no extra draw call. (3) A prop model (Mario's Cape `mantle`, FLUDD `pump`, Cappy `cappy`, Samus's `gun`/`missile`, Fox's `blaster`, `arwing`): add an upstream folder to the pipeline — `MODEL_PARTS: Record<fighterId, readonly string[]>` beside `FIGHTER_CODES` in `pipeline/manifest.ts`, fetched from `fighter/<code>/model/<part>/c00/` and built into `public/models/<id>.<part>.<sha8>.glb` by the same `build.mjs` loop — and parent it to the bone `HaveR`/`HaveL` of the `Fighter3D` while the slot is live; each prop is one or two draw calls inside the budget (list its meshes in `meshes.json`; the export joins them).

### The model pipeline

`pnpm models:fetch` (`--update-manifest`, `--only`), `pnpm models:skeletons` (no Blender), `pnpm models` (`--only <id>`, `--allow-skeleton-drift`; Blender), `pnpm models:check`; `scripts/models/meshes.json` (every mesh kept or dropped, per fighter); `public/models/index.json` `{ schema: 1, models: { <id>: { file, bytes, sha256, skeleton } } }`; `.model-cache/{src,tools,glb,dumps}/`; regeneration commands `UPDATE_SKELETONS`, `UPDATE_BAKE`, `UPDATE_HURT`, `UPDATE_LIMB`, `UPDATE_REACH` (plus Plans 2–3's `UPDATE_GOLDEN`, `UPDATE_RECONCILE`).

## Verification record (scratch)

Scratch tree: `/private/tmp/claude-501/-Users-fobrizzlemynizzle-Documents-Personal-Projects/1b5c93cf-4a75-4d9f-92bb-6a571bd2578b/scratchpad/plan4-6258/ws4` — a clone of Plan 3's final branch `plan3b` (`plan3-b8e2/ws2`, 21 tasks) with its tracked `node_modules` symlink removed and a real copy in its place, and this plan applied on top (three 0.186.1, @gltf-transform 4.5.1, meshoptimizer 1.3.0, sharp 0.35.3; the eight fighters fetched at the pinned commit into its `.model-cache/`). Step-by-step replay of Tasks 10–13 and the red steps of Tasks 6, 8, 9–13, 20: `…/plan4-6258/ws5`. Plan parts and their assembler: `…/plan4-6258/parts4/`, `…/plan4-6258/variants4/`, `…/plan4-6258/assemble.py`.

Could verify: every TS module and test (typecheck, lint, vitest: 132 files, 3,094 passed, 1 skipped — the Blender cross-check); the SDNA reader on all eight real `.blend` files and the committed skeletons byte for byte; the mesh lists against every mesh in every file; the bake, hurt ratchet, limb list, reach and reconcile allowlists and golden trace from the real inputs, reproduced by replaying Tasks 10–13; every changed task's failing message; `fetch.mjs` (no Node warning) and `skeletons.mjs`; `glb.mjs`'s primitive cap on generated glbs; the presenter's draw calls with four 12-primitive models (55); `next build` and the `/play` chunk split (520 → 356 KB gzipped initial); the whole e2e suite in headless Chromium (19 passed, 7 skipped by design) plus `e2e/render3d.spec.ts` (4 passed, 8/8 on repeat); the 3D lab capture into `test-results/anim/`; the screenshot capture with SSBU-sized stand-ins and head-anchored tags; Task 23's swing-arc removal.

Could not verify (no Blender, by instruction): running `export_gltf.py` and its join; real glb sizes, triangle and draw-call counts in a browser (`REQUIRE_MODELS=1`); Plan 1's final `play/page.tsx`, online page, CharacterSelect and onlineStore text (Task 20 Steps 7–8 are by symbol); Task 23's deletions other than the swing arcs; the deploy.

