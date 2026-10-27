# Rebuild research: SSBU recomp repos, physics, compute, free hosting (2026-10-24)

Research-only pass. Nothing in `src/` was changed. Sources were gathered by five reader agents: the local replica map, the two GitHub repos, physics and compute, and hosting. Free-tier limits were read from vendor pages on 2026-10-24.

Files in this folder:
- `ssbu_fighter_params.csv`: 89 fighters × 32 movement columns. Extracted from rubendal/SSBU-Calculator `Data/<fighter>/data.json` (MIT code; the values are derived from game files, so see Legal).
- `tools/ssbu_ref.mjs`: a reference JS port of knockback, hitstun with balloon speed-up, hitlag, shieldstun and DI.
  - `tools/cross_check.mjs` checks it against the calculator: max KB diff 2e-13 over 20k random cases, and 0 mismatches for hitlag, shieldstun and speed-up.
- `tools/sim_bench.mjs`: a toy 60 Hz tick benchmark.

---

## 1. Headline: the two repos cannot donate graphics, movement, attacks or AI

Both repos are **static recompilers**, not source ports:

- **Denkishi/ssbu-recomp**, now `OpenSmash-Ultimate/ssbu-recomp`
  - GPL-3.0, created 2026-10-12, about 450 stars, AI-written.
  - Lifts the user's own 13.0.4/13.0.5 dump into about 3.8 GB of register-level C. That is 112,890 functions of the form `void f_<addr>(Ctx*)`, built into a 511 MB DLL plus 98 fighter-script DLLs.
  - Renders NVN→Vulkan 1.3 (GL 4.6 fallback). Maxwell shaders are translated to GLSL→SPIR-V.
  - Netplay is the game's own Local Wireless (nn::ldn) tunnelled over UDP. Rollback is "in progress".
- **SNO2207/WindowSmash**, now `OpenSmash-Ultimate/WindowSmash`
  - GPL-3.0, created 2026-10-18, one author, AI-written.
  - Same idea with a different lifter. It renders Maxwell→**D3D11** (HLSL SM5), with a Metal port and Linux via DXVK.
  - Netplay is the game's own delay-based LDN netcode over a stdlib-Python **UDP** relay. It is explicitly *not* rollback.
- The two projects are now being **merged** into `OpenSmash-Ultimate/OpenSmash-Ultimate`.

What that means for "take the graphics, movement, attack logic, CPU, controls":

| Wanted | Is it in the repos? | Reality |
|---|---|---|
| Graphics | No. Only a translator for *Nintendo's* shaders and GPU command streams. | It renders only assets from the dump. WebGL2 can't run it (no compute or storage buffers); WebGPU would need a new WGSL backend and BC textures. Pointless without the dump, and illegal to serve. |
| Movement / attack logic | No. It is opaque recompiled AArch64 → C, generated on the user's PC. | ssbu-recomp's `fighter_sdk/tools` can decompile *your own dump's* ACMD scripts to readable C++ (claims 95%), catalogue hitboxes (`hitcat.py`) and read `.prc`/`motion_list`/`nuanmb`/`ssbh`. The output is gitignored and marked "never publish". The core knockback, kinetic and collision engine is never turned into source. |
| CPU AI | No. Part of the recompiled binary ("no source"). | Nothing to port. |
| Controls | Thin layers: SDL3 / XInput / GameCube adapter → Switch Npad. | Portable only as conventions: keyboard defaults, deadzones, a per-device profile UX. The game's own code decides dash, tilt and buffer. |
| Netcode | ssbu-recomp's `runtime/rb_*.c` is small, plain C rollback modelled on Slippi: 7-frame max, time-sync nudges of 0.5–1%, stick-rest clamp. | A good **design** reference. Copying code makes the replica GPL-3. Our own `src/net/rollback.ts` already does the same job. |

Running the real thing online is not feasible:
- It needs Windows (or Linux/macOS experimental), Vulkan 1.3 or D3D11, about 14–16 GB RAM, about 17 GB of game data plus a 30–60 GB build, and a fixed 64-bit guest address space (`0x7100000000`, "guest pointers are host pointers").
- It can't run as WASM.
- No free tier has a GPU (Oracle, GCP, Colab and Lightning were all checked).
- Streaming adds a full round trip plus encode/decode per input, which is wrong for a fighter.
- Both projects forbid distributing anything built from a dump. WindowSmash withdrew its prebuilt exe on 2026-10-22. Nintendo removed hundreds of Suyu forks in Aug 2026, and Kotaku names this recomp in that wave.

**What we *can* use:**
1. Public, re-implementable mechanics and formulas (section 3). The formulas are verified.
2. Public param names and data formats, which give the right data model.
3. Netcode and relay *design*: rate limits, lobby partitioning, hole-punch then relay fallback.
4. Controller conventions.
5. If you own a dump: a local, never-published use of `hitcat.py` / `prc.py` to sanity-check our tuning.

---

## 2. Why the current replica felt wrong (from the local code map)

The **simulation is the strong part**: about 13.8k lines covering engine, fighters and stages.
- Deterministic Q12 fixed point, exact `Ratio` constants and a LUT sine.
- Pure `step(state, inputs, {prevInputs})` at a fixed 60 Hz.
- A full KB / hitlag / DI / SDI / LSI / shield / staling / ledge pipeline.
- About 1,630 unit tests.
- Rollback netcode (`src/net/`, 2.1k lines) is written and tested **but never wired in**. The menu shows "Online — Not built", and nothing outside `src/net` imports it. The gamepad module is also unwired.

The **trouble lives in the presentation and action layers**: about 39k lines of procedural Canvas2D stick figures.
- Hand-keyed bone-angle clips **decoupled from the sim**. Hitboxes are **static origin-relative offsets**, not bone-attached. Animation never feeds the sim, so they drift apart.
  - DECISIONS D34: attacks "don't look like anything".
  - D39: 17 of 21 non-attack clips were one keyframe.
  - D44: 32 specials share 4 clips.
  - D52: "several rigs cannot reach their own hitboxes"; "the lab and the renderer disagreed four times in one pass".
- **Specials with data but no engine code**: reflectors, counters, Cape, FLUDD, cargo, Inhale, Final Smash, wall jump, tech, ledge trump, footstool, Samus charge storage.
- Probable bug: double super-armour damage at `simulate.ts:1154/1164`.
- **Collision is origin-point only**: no ECB and no slopes. The hurtbox is one capsule.

**Root-cause fix (architecture, not tuning):**
- Make one skeletal animation the source of truth for both rendering and hitboxes.
- Bake bone transforms per frame into **integer tables at build time**. The sim reads hitbox and hurtbox positions from the tables, so it stays deterministic and float-free. The renderer plays the same clip, so the two cannot disagree by construction.

---

## 3. Physics: real SSBU vs the replica

Real values come from SmashWiki (CC BY-SA 4.0) and rubendal/SSBU-Calculator `js/formulas.js` (MIT, ported and cross-checked). Units are 1 u = 0.1 m at 60 Hz, units/frame.

| Mechanic | Real SSBU | Replica today | Gap |
|---|---|---|---|
| Knockback | `((((p/10+p·d/20)·200/(w+100)·1.4)+18)·kbg/100+bkb)·r`, with r = rage × CC 0.85 × launch rate. d uses only 0.3× staling. Set-KB uses p=10, d=fkb. | Same | ✓ |
| Launch speed | KB×0.03, decays 0.051/f along the vector | Same | ✓ |
| **Hitstun / balloon speed-up** | Base `floor(KB·0.4)−1`. Above tumble the launch is **sped up up to 6×** (`init_damage_speed_up`; algorithm in `tools/ssbu_ref.mjs`). Effective hitstun at KB 90/145/200/250 is 33/41/49/61. Above 200, +(KB−200)·0.25. | Plain `floor(KB·0.4)−1`. "Balloon" in the replica only pins fall speed at 70–110°. | **Major.** High-% launches are far too long and floaty, and combos and KO feel are wrong. |
| Hitstun cancel | Air dodge after 40 f if launch speed < 2.5; aerial after 45 f if < 2 | Not seen | Missing |
| **Sakurai angle 361** | Aerial 38°. Grounded 0° below KB 60, linear to 38° at 88. | Grounded 0° / airborne 44° (binary) | Wrong values |
| DI | Max 0.17 rad (9.74°), **linear** in the perpendicular stick component (`|sx·ly−sy·lx|/|L|`), deadzone 24/120. Skipped when the launch angle is under 0.17 rad. | 9.74°, scaled by the **squared** perpendicular component | Verify / fix |
| LSI, SDI | LSI ×1.095 up / ×0.92 down, off at 65–115° and 245–295°. SDI 2 u per pulse, 4-f gap, ×1.15 every 5 hits. | Similar, no ×1.15 | Minor |
| Hitlag | `floor(floor(floor((d·.65+6)·h·e·s)·p)·c)`, cap 30, electric 1.5, shield 0.67, CC 0.67 both sides. p is the player-count factor (1.0 in 1v1). | Same (no player-count term) | ✓ for 1v1 |
| Shield | 50 HP, **×1.19 damage**, −0.15/f held, +0.08/f, 37.5 HP after a break. Shieldstun `floor(d·.8·m+3)−1` (m: proj .29, aerial .33, smash .725). Pushback formulas exist. | Stun formula equivalent, decay/regen same. 240-f break stand-in; ×1.19 not seen. | Small |
| Perfect shield | Release in the first 5 f of the 11-f drop. Direct melee: attacker +14 hitlag, defender +11. | Attacker +20 hitlag | Wrong values |
| Staling | 9 slots: .09 .08545 .07635 .0679 .05945 .05035 .04255 .03345 .025. Fresh ×1.05. Shield hits ×0.85. | "9% down to 1%" | Verify the table |
| **Jumps** | Full hop covers 0.55·h over the first 4 frames, then `v0=√(2g(h−i))+g/2`. SH and air jump `v0=√(2gh)+g/2`. No gravity on jump frame 1. | `v=√(2gh)` | Arcs wrong for every fighter |
| Multi-jumps | Kirby/MK/Puff 5 midair, Dedede 4, Pit 3, Charizard/Ridley/Banjo 2 | Kirby: one velocity, no taper | Missing |
| **Air friction** | Per fighter (0.00375–0.05) when the stick is neutral | "No air friction" | Missing: no drift decay |
| Walk / dash | Walk has its own accel and max. Dash = initial speed, then `RunBase+RunAdd·|stick|` to run. Traction decays. | Walk approaches at traction×2; no walk initial velocity (known gap) | Missing params |
| Landing | Per-aerial landing lag. Soft/hard landing (Mario 1/3, hard after 4 f at terminal fall). Air dodge LL 10 / 19 directional. | Aerial LL plus air dodge | Soft/hard missing |
| **ECB** | 4-point diamond from bones, bottom locked on ground | Origin point only | Ledge and platform feel |
| **Hitboxes** | Spheres or capsules on **bones**, moved by animation. Lowest id wins. Glancing blow at ≤0.1 u overlap. | Static offsets from origin | **Root cause** of the action trouble |
| Hurtboxes | Per-bone capsules with states (intangible, invincible, shield…) | One capsule | Missing |
| Tech | 11-f window, 40-f lockout. Floor techable at speed ≤ 3, walls/ceilings ≤ 6. | None | Missing |
| Ledge | Intangibility `60·a/300 + 44 − 44·p/120`, plus a 19-f grab animation. 6 regrabs; ×0.8, ×0.5, then 0. Ledge trump. 6.5 s auto-drop. | Close formula, 6 regrabs, no trump | Minor |
| Knockback stacking | A new launch at 0.5–0.9× of the current speed keeps the first launch; below 0.5× counts as armour | Not seen | Missing |
| Rage, 1v1 ×1.2, CC, smash charge (×(1+f/150), max 1.4) | — | Same | ✓ |

Per-fighter attributes for all 89 fighters are in `ssbu_fighter_params.csv`. The 8 replica fighters' existing values match the published ones.

Ranges across the roster:

| Attribute | Min | Max |
|---|---|---|
| Weight | 62 | 135 |
| Gravity | .053 | .23 |
| Fall speed | .98 | 2.1 |
| Run speed | 1.18 | 3.85 |
| Full hop | 16.5 | 50.5 u |

Still unverified anywhere public:
- The exact per-frame ground and air update equations.
- Stick thresholds for walk/dash, platform drop and SDI.
- ECB sizes per animation.

Tune these against Ultimate Frame Data distances.

Stage data:
- Blast zones (L, R, top, bottom): FD (−240, 240, 180, −140), BF (−240, 240, 192, −140).
- Battlefield platforms are at y 24.119 and 47.189.

---

## 4. Compute

- **Switch:** Tegra X1, 3 usable A57 cores at about 1.0 GHz, a Maxwell GPU of 157–393 GFLOPS, 4 GB RAM.
  - SSBU runs 1080p60 docked and 720p60 handheld.
  - 8 players hold 60 (it only struggles with 8 Ice Climbers).
- **Native recomp on PC:** reports 59–60 fps in 1v1 on an Intel Raptor Lake **iGPU**. The real engine is light; the hard part is the 17 GB of content.
- **Browser client at "Switch-ish" stylised fidelity:**
  - Any 2018+ laptop iGPU with WebGL2 handles it. WebGPU is optional (Chrome/Edge 113+, Firefox 141+ on Windows, Safari 26).
  - Budget: under 100 draws, under 500k skinned tris, KTX2/Basis textures, GPU skinning (16 KB uniform block = 256 bones) or a bone texture.
  - Passes: depth/shadow → opaque → blended → bloom → LUT colour grade. Pass list from ScanMountGoat/Smush-Material-Research.
- **Sim:**
  - The toy benchmark is 0.26 µs/tick for 2 fighters and 4.4 µs for 8. An 8-frame rollback resim is under 150 µs.
  - A real engine is about 100–1000× heavier, still under 1 ms per tick. Rollback is fine on the client.
- **Server:** with P2P rollback the server runs *no* sim, only signalling. An authoritative 60 Hz sim for 2–4 players would also be trivial (about 1–6% of a core).
- **Bandwidth:** inputs about 2–3 KB/s per client.

---

## 5. Free hosting (fewer than 3 concurrent users), verified 2026-10-24

**Recommended: one free Cloudflare account, P2P rollback.**
1. **Client:** Workers Static Assets.
   - Requests are free and unlimited; 20k files, 25 MiB per file.
   - Chunk or compress assets (Draco/meshopt/KTX2). Use hashed filenames plus `_headers` immutable caching.
2. **Lobby and signalling:** one **SQLite-backed Durable Object per room** with WebSocket Hibernation.
   - It exchanges SDP and ICE, and its SQLite (5 GB free) stores accounts, lobbies and stats. **No Neon needed.**
   - Never run a `setInterval` tick in the DO, because that blocks hibernation.
3. **Match traffic:** WebRTC DataChannel `{ordered:false, maxRetransmits:0}` carrying the existing `src/net` rollback packets. Redundant last-10-frames input windows already exist.
4. **NAT:** `stun.cloudflare.com` (free, unlimited) plus **Cloudflare TURN**: 1,000 GB/month free, credentials minted by the Worker. This fixes the replica's documented "no TURN" gap.
5. **Last-resort fallback:** relay inputs through the DO WebSocket.
   - Incoming messages bill 20:1 against 100k requests/day: 2 players × 60 msg/s ≈ 4.6 h/day of relayed play, or about 9 h/day if two frames are packed per packet.
   - TCP head-of-line blocking hurts here, so this is a fallback only.
   - At the cap, operations fail until 00:00 UTC, so keep a counter.

**Alternates:**
- **Zero-server:** keep Trystero/Nostr signalling, which is what the replica already ships, plus Cloudflare TURN. Host on GitHub Pages, Vercel or Cloudflare. Public Nostr relays come with no SLA.
- **Always-on VM** (only if you want a server-authoritative sim): GCP e2-micro (US regions, 1 GB/month egress, card required) or Oracle Always Free.
  - Oracle A1 was **halved to 2 OCPU / 12 GB**. Idle instances are reclaimed after 7 days below 20% use, which is exactly a quiet relay's profile.
- **Vercel Hobby:** fine for the static client, as with the other Replicates projects (non-commercial only).
  - Vercel Functions WebSockets went GA on 2026-10-20 but close at 300 s on Hobby. Each connection is pinned to one instance in one region (iad1), so not for match traffic.

**Dead or not free now:**
- PartyKit hosted (shut down 2026-10-23; use the `partyserver` library on your own Cloudflare account instead)
- Hathora (May 2026)
- Fly.io (no free tier)
- Koyeb free (closed to new sign-ups)
- Deno Deploy (closing about Apr 2027)
- AWS (6-month credits only)

**Too small for 60 Hz relaying:**
- Supabase Realtime (100 msg/s; pauses after a week idle)
- Ably (6M/month ≈ 55 min of play)
- Pusher (200k/day ≈ 28 min)

**Unverified:** whether Cloudflare TURN or R2 asks for a card on a free account. Check the dashboard first. Small files avoid R2 entirely.

---

## 6. Architecture transform: Windows recomp → free browser game

| Layer | Recomp repos (native Windows) | Target (browser, free) |
|---|---|---|
| Game code | Nintendo AArch64 lifted to C, about 1 GB DLLs | Our TS (or Rust→WASM) deterministic fixed-point sim. Keep `src/engine`'s Q12/`Ratio` discipline and `step()` ordering. |
| Gameplay data | `.prc` / ACMD / `motion_list` inside a 16 GB `data.arc` | Our own typed tables mirroring the public param model (`walk_speed_max`, `jump_y`, `air_accel_x_*`, `ATTACK(id, bone, dmg, angle, kbg, fkb, bkb, size, x,y,z[,x2,y2,z2], hitlag, sdi, …)`). Per-move `game_` scripts are frame-indexed command lists with `frame()` / `wait()` semantics. |
| Animation → hitboxes | Bone-attached via the engine | **Build-time bake** of glTF skeletal clips into integer per-frame bone tables. Hitboxes and hurtboxes hang off bones, so sim and renderer can't drift. |
| Renderer | NVN → Vulkan / D3D11, about 8k Nintendo shaders | WebGL2 (three.js or a thin custom layer), skinned glTF, toon/rim shading, bloom, LUT. WebGPU later. |
| Assets | Nintendo's, from the dump | Original or CC0 (e.g. Quaternius/Kenney CC0 rigs, Mixamo animations embedded in the game), KTX2. **No ripped assets.** |
| Input | SDL3 / XInput → Npad, 1 ms poll | Gamepad API (the existing unwired `src/input/gamepad.ts`, deadzone .18 / walk .28 / dash .72) plus the latched keyboard reader. Analog sticks restore walk and partial DI. |
| CPU | Recompiled Nintendo AI | Existing pure `cpuInput()` utility AI (9 levels), extended per new mechanics |
| Netplay | LDN emulation over a UDP relay (delay-based), or rollback (WIP) | WebRTC P2P plus the existing GGPO-style `RollbackSession` (delay 1–8 auto, 8-frame prediction, desync hash). Signalling via a DO or Trystero; TURN fallback. |
| Hosting | User's PC; Python UDP lobby on an Oracle VM | Cloudflare Workers Static Assets + Durable Objects + TURN, all free tier |

Open-source references worth reading for design (check the licences before copying code):
- netplayjs (ISC)
- GGRS / matchbox (Rust→WASM)
- Slippi (7-frame rollback)
- `3-Hz/pfengine` (fixed-point Melee-like plus GGRS WASM)
- `Vaprin32/smash` (TS Canvas WebRTC fixed-point; no licence file)
- Rivals of Aether workshop docs
- `ScanMountGoat/ssbh_wgpu` and Smush-Material-Research (Smash render pipeline notes; MIT)
- rubendal/SSBU-Calculator (MIT formulas)

---

## 7. Legal (not legal advice)

**Low risk:**
- Re-implementing mechanics and formulas from public docs.
- Original code and assets.
- Keeping MIT notices when adapting the calculator code.

**High risk:**
- Shipping ripped models, textures, sounds or animations.
- Hosting recompiled or emulated builds.
- Copying decompiled Nintendo logic. ssbu-recomp's "readable C++" is derived from Nintendo's binary.
- Wholesale per-move data tables.
- Copying GPL/AGPL code (the recomps, HDR) into a non-GPL project.

Already present in the replica:
- The "Super Smash Bros." name and Nintendo character names.
- Move numbers derived from rubendal's ACMD and LVD dumps (D17).

Nintendo history:
- Yuzu $2.4M settlement (2024).
- Ryujinx stopped (2024).
- Game Jolt mass takedowns.
- AM2R.
- Big House Online C&D.
- The Palworld mechanics-patent suit, with a ruling expected around 2026-11-09.
- Suyu forks removed (Aug 2026).

Public hosting raises the exposure. Options: keep the URL unlisted, rename to an "inspired-by" game with original fighters, or accept the risk knowingly.

---

## 8. Decisions needed before the build phase

1. **Visual target:** 3D skinned glTF in WebGL2 (closest to SSBU; needs CC0/original models plus an animation pipeline) vs 2D skeletal (Spine-like) vs keeping Canvas2D with baked tables.
2. **Keep the engine or rewrite:** the recommendation is to keep and extend `src/engine` + `src/net` + `src/ai` (about 17k lines, well tested) and replace the presentation layer. Rust→WASM (GGRS + fixed point) is the alternative if raw sim performance matters, which it doesn't at this scale.
3. **IP posture:** Nintendo names and characters vs original fighters.
4. **Data source:** keep public/derived numbers, or use a dump you own with ssbu-recomp's tools *locally* to calibrate (never committed).
5. **Hosting:** all Cloudflare (recommended) vs Vercel static + Cloudflare DO/TURN vs zero-server Trystero.
