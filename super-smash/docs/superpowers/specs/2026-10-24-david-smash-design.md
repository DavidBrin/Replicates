# David-Smash: design spec (2026-10-24)

Evidence for this spec is in `research/rebuild-2026-10/README.md`, abbreviated "R" below (R§N = section N).

The decisions were made by David on 2026-10-24. This spec turns them into requirements.

## 1. Decisions (David's words → requirement)

| David said | Requirement |
|---|---|
| "keep it 2D if it still looks similar and makes the rendering/engine faster, otherwise make the 3d models and keep the movement pictures for animations" | **Go 3D** (see §2). The existing pose clips (`src/render/poses/**`, `src/render/chars/*/clips*`) stay the animation source and are retargeted onto 3D skinned models. |
| "extend the current one but make it as similar to the github engine as possible" | Keep and extend `src/engine`, `src/net`, `src/ai` (do not rewrite). Restructure the engine toward the SSBU engine visible through the recomp projects and HDR (R§3, R§6): **fighter params with `fighter_param.prc` names**, a **Kinetic module of summed energies**, **per-status pre/main/end functions**, and **ACMD-style per-move `game_` scripts** (`frame(n)` / `wait(n)` / `ATTACK(...)` / `AttackModule::clear_all`) with **bone-attached hitboxes**. |
| "keep nintendo names" | The 8 fighters keep their names (Mario, Donkey Kong, Link, Samus, Kirby, Fox, Pikachu, Marth). |
| "published numbers only for data" | Every gameplay number cites a public source: SmashWiki, UltimateFrameData, rubendal SSBU-Calculator / Data Viewer, or Kurogane. No dump, and no use of the recomp `fighter_sdk` tools. Numbers we cannot source are tuned and marked `UNVERIFIED:`, as the repo already does. |
| "go with recommendation" (hosting) | One free Cloudflare account: Workers Static Assets, a per-room SQLite Durable Object for signalling, Cloudflare TURN, and WebRTC P2P rollback (R§5). |
| "write a plan to remediate the current hosted game … if you see a real benefit" | There is a benefit (§4). Take down the Vercel app `smash-david.vercel.app` and switch every link to the new URL. |
| "change to David-Smash" | Product name **David-Smash** everywhere a user can see it. |
| "legal should not be an issue" / "5–10 users" | No IP gating in the product. See the operational constraint in §3.1. |

## 2. Why 3D (the 2D/3D test David set)

David's test: 2D only if it **looks similar** AND is **faster**. It fails on both counts.

- **Looks similar: no.** SSBU is 3D-rendered 2.5D. A 2D renderer cannot look like it unless it pre-renders sprites *from* 3D models, which needs the models anyway and loses camera zoom quality. The current Canvas2D stick figures are what play-testing rejected (DECISIONS D34, D39, D44, D52).
- **Faster: no.** The renderer does not affect engine speed. `step()` is renderer-independent: R§4 measures 0.26–4.4 µs/tick. Canvas2D draws every capsule, outline and VFX on the CPU. WebGL2 moves skinning and fills to the GPU. 2–8 skinned meshes plus a stage is a light GPU load on any 2018+ iGPU (R§4).

Therefore: **three.js (WebGL2) 3D renderer, skinned glTF fighters, side camera.**
- The HUD, menus and audio stay as they are.
- The existing clips drive the 3D bones.
- The sim keeps a fixed side-on 2D plane, as SSBU does.

## 3. Requirements

### 3.1 Global constraints
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

### 3.2 Phases (each phase is one plan; run strictly in order 1 → 5, because each plan is written against the code the previous one leaves)

| # | Plan | Depends on | Ships |
|---|---|---|---|
| 1 | **Rename + Cloudflare hosting + online play + gamepad + Vercel remediation** | — | David-Smash live on Cloudflare with working online matches (TURN), gamepads, old Vercel app down, links switched |
| 2 | **Engine architecture alignment** (params with prc names, Kinetic energies, Status modules, ACMD game scripts, movement-fidelity fixes) | 1 (written against Plan 1's code) | Same game, SSBU-shaped engine, correct jump arcs, air friction, walk/dash, landing, multi-jump |
| 3 | **Combat fidelity** (balloon speed-up, hitstun cancel, Sakurai angle, DI, perfect shield, shield ×1.19, staling table, KB stacking, tech, glancing blows, SDI ×1.15, ledge trump, super-armour double-damage bug) | 2 | Combat numbers match R§3 |
| 4 | **3D renderer** (model pipeline, three.js renderer, clip retargeting, bone-attached hitbox bake, 3D stages, camera, VFX, /anim lab) | 3 (written against Plan 3's code) | 3D David-Smash, hitboxes follow limbs |
| 5 | **Missing specials, Final Smash, CPU and controls** | 3, 4 | Reflectors, counters, Cape, FLUDD, cargo, Inhale, Samus charge store, wall jump, footstool, Final Smashes; CPU uses the new mechanics |

### 3.3 Phase 1 detail requirements
- **Name:**
  - "David-Smash" in `<title>`, menus, README, `package.json` name, Worker name, Trystero/rooms `appId`, the `/fighters` and results screens, and the David-Internet and wiki display names.
  - Wiki and David-Internet **slugs stay**.
- **Build:**
  - Next.js `output: "export"` static build into `out/`.
  - All 9 routes are already static (R§2, `find src/app -name route.ts` is empty).
  - Cloudflare Worker `david-smash` with `assets.directory = "./out"` and `run_worker_first` only for `/api/*` and `/ws/*`.
- **Signalling:**
  - `RoomDO` (SQLite-backed Durable Object, WebSocket Hibernation API), keyed by 4-letter room code via `idFromName`, max 2 peers (v1 is 2-player online).
  - Relays SDP/ICE JSON messages between the two sockets.
  - Room code alphabet is unchanged (no I or O).
- **TURN:**
  - The Worker mints short-lived Cloudflare TURN credentials at `GET /api/ice` (TTL ≤ 48 h, e.g. 4 h).
  - Secrets `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are set with `wrangler secret put` by David.
  - If no TURN key is configured, the client falls back to STUN only (`stun.cloudflare.com:3478`).
- **Transport:**
  - A new `DurableObjectSignalling` WebRTC adapter implements the existing `Transport` port. Gameplay goes over an unreliable unordered DataChannel (`ordered:false, maxRetransmits:0`), keeping `webrtc.ts`'s negotiated id 42 convention.
  - The Trystero adapter stays as an alternate selectable in code only.
- **Online UI:**
  - Main menu "Online" tile becomes live: Create room (shows code) or Join room (enter code), then the existing character/stage select (host picks the stage), then the match.
  - `matchRunner` runs a `RollbackSession` for online matches.
  - Shows ping, input delay and rollback count.
  - Disconnect → results screen with "Connection lost".
- **Gamepad:** `src/input/gamepad.ts` is wired into local and online matches (analog stick gives walk, tilt and partial DI). Keyboard stays.
- **Remediation (benefit: §4):**
  1. Deploy and verify the Cloudflare site (e2e against the public URL, plus a two-browser online match through TURN).
  2. Update David-Internet (`content/super-smash/site.ts` `liveUrl`, README table, `e2e/images.spec.ts`, `e2e/feeling-lucky.spec.ts`) and the wiki (`Replicates/Wikipedia/src/content/projects.ts` `liveUrl`, plus display name), and redeploy both (manual Vercel CLI).
  3. Remove the Vercel project behind `smash-david.vercel.app` with David's go at that step.

### 3.4 Phase 2–5 requirements
See R§2, R§3 and R§6 (the gap table there is normative):
- Each "Missing", "Wrong values" or "Verify" row is fixed in phase 2 or 3, with a test citing the source URL.
- Each documented-but-unimplemented special in R§2 is implemented in phase 5.
- Phase 4 meets the R§4 budget: under 100 draw calls, under 500k skinned tris, a 60 fps target on an Intel Iris Xe class iGPU at 1080p, and glb files under 25 MiB each.

## 4. Why remediation is worth doing
- **Online works only on the new stack.** The Vercel app has no online play at all (the tile reads "Not built"), and Vercel Hobby can't host the signalling: Functions WebSockets close at 300 s and are pinned to one instance.
- **One live copy.** Two live copies would drift, and the David-Internet "Feeling lucky" and image tests point at the old one.
- **The URL becomes the David-Smash name** rather than "smash-david".
- **Cost:** none. Same free tier, and the existing account already hosts Leaders.
