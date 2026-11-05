# David-Smash rebuild: roadmap (2026-10-24)

Seven implementation plans turn the `super-smash` replica into **David-Smash**: SSBU-shaped engine, published combat numbers, 3D models, online play, hosted free on Cloudflare, then a polish pass (Plan 6) and a relay through the room with online play for up to four (Plan 7).

- **Why:** `../specs/2026-10-24-david-smash-design.md` (requirements, David's decisions).
- **Evidence:** `../../../research/rebuild-2026-10/README.md` (repo analysis, physics gap table, compute budget, hosting comparison).

**Status: Plans 1-6 are executed and deployed** (each plan's record is the decision in its row below). Each plan was drafted and replayed task by task in a scratch copy of the repo, then reviewed independently and revised before it ran. Plan 6 was deployed on 2026-11-03 (rules version 6). **Plan 7 Phase A executed** (the relay fallback, D60): its deploy checkpoint is the controller's and waits for David's go, and Phase B (three and four players) starts after it.

## Order

Run the plans strictly in this order. Each plan is written against the code the previous one leaves, and each one cites the earlier plans' interfaces by symbol.

| # | Plan | Tasks | Decision | What ships |
|---|---|---|---|---|
| 1 | [Hosting, online, rename](2026-10-24-plan-1-hosting-online-rename.md) | 27 | D54 | David-Smash on a Cloudflare Worker (`https://david-smash.leaders-game.workers.dev`), with two-player online over WebRTC + TURN, gamepads, the Vercel copy removed and links switched |
| 2 | [Engine architecture](2026-10-24-plan-2-engine-architecture.md) | 29 (0–28) | D55 | `fighter_param.prc` params, Kinetic energies, Status pre/main/exec/end, ACMD `game_` scripts imported for all 8 fighters, plus correct jump arcs, air friction, walk/run, landings and a first ECB |
| 3 | [Combat fidelity](2026-10-24-plan-3-combat-fidelity.md) | 21 | D56 | Speed-up hitstun, Sakurai angle, DI/LSI/SDI, shields, perfect shield, staling, KB stacking, tech, glancing blows, grabs, ledge trump, and 38 root-bone scripts live |
| 4 | [3D renderer](2026-10-24-plan-4-3d-renderer.md) | 23 | D57 | three.js renderer with SSBU models (fetched locally, never committed), clips retargeted, bones baked into integer tables, per-bone hurtboxes, SSBU sizes, and 50 limb-bone slots live (53 planned; D57) |
| 5 | [Specials, Final Smash, CPU, controls](2026-10-24-plan-5-specials-final-smash-cpu.md) | 23 | D58 | Charge-on-B, Reflector, Cape, Counter, F.L.U.D.D., Cargo Carry, Inhale/Copy, wall jump, footstool, crawl, throws/pummels and smash attacks on their scripts, eight Final Smashes with the Smash Ball, a CPU that techs, escapes, parries and uses specials, Stick Jump and gamepad remap |
| 6 | [Polish](2026-11-02-plan-6-polish.md) | 42 | D59 | Input never dropped online, the flick's rules, reverse smash, edge slip, air grab, Final Smash records, slowdown and boosts, Thunder Jolt walls, a smarter CPU Final Smash, the online screens, press-to-join, sounds, 3D stage and fighter polish, authored carry and release motions, model portraits, a settled online e2e |
| 7 | [Relay and four-player online](2026-11-04-plan-7-relay-and-four-player-online.md) | 18 | D60 | Players whose networks block a direct link play through the room's Durable Object (Phase A, deployed on its own first), then rooms hold up to four players online, all through that relay (Phase B). No TURN: David has no payment card |

`ENGINE_RULES_VERSION` goes 3 (Plan 3) → 4 (Plan 4) → 5 (Plan 5) → 6 (Plan 6). Online peers on different versions refuse to play each other, so both players must reload after a deploy.

## Steps that stop for David

Every outward or installing step says **STOP: ask David for go** and waits for an answer.

| Plan / Task | What it does |
|---|---|
| 1 / 24 | `wrangler login` (David runs it with `!`), first deploy of the Worker, TURN secrets, public-URL e2e and a two-browser online check. If TURN needs a card, the site ships STUN-only. |
| 1 / 25 | Point David-Internet at the new URL and redeploy it. This step stops if another session's uncommitted edits are still in that repo. |
| 1 / 26 | Rename and relink the Wikipedia article, then redeploy. |
| 1 / 27 | `vercel project rm smash-david`. This cannot be undone, and it runs only after 24–26 are verified live. |
| 4 / 7 | Download Blender 5.2.2 (346 MB) into the git-ignored `.model-cache/tools/`. If David says no, the game still works, with capsule stand-ins in place of models. |
| 4 / 23 | Deploy the 3D build. |
| 5 / 23 | Deploy the finished game (rules version 5) |
| 6 / 42 | Deploy (rules version 6), on David's go: deployed 2026-11-03 |
| 7 / Deploy checkpoint | Deploy the relay fallback (Phase A; rules version 6 and protocol 2 unchanged), on David's go. Then the live online e2e, and the measured delay and cost go into D60. Phase B starts only after it |

Plans 2 and 3 do not deploy. Their changes go live with the next deploy David approves.

## Decisions the planner made (confirmed when David approves the plans)

- Commit the research folder, the generated rubendal `game_` scripts (about 284 KB), the 8 derived skeleton JSONs and the bone bake (1.58 MB gzipped). No Nintendo-ripped file (`.blend`, `.glb`, textures) is ever committed; a git guard enforces this.
- Interim online without a card: STUN-only if Cloudflare TURN asks for billing. Permanent since Plan 7 (D60): the room relays when no direct link opens.
- Do not ship another session's uncommitted David-Internet edits along with the relink.
- `Btn.Soft` (soft-stick button) lands in Plan 1. Online v1 has no rematch: both players return to the lobby.
- On an engine-fingerprint mismatch, the guest tells the host and both see the error.
- Fighters use SSBU model sizes; the legacy invented sizes are only the no-model fallback. Hurtboxes, ECB and reach change (DK grows from 15.0 to 26.3 units tall).
- Blender is portable, inside `.model-cache/tools/`. Skeletons are read without Blender, so only the glb export needs it.
- No bloom and no facial-expression swaps. Fighter `scale` scales limbs and hurtboxes, not ATTACK sizes.
- The screenshots in `docs/` are regenerated in 3D.
- Plan 5 rules, as landed (D58; UNVERIFIED where marked):
  - A footstool can be made off a fighter in hitstun (SmashWiki "Footstool Jump", ruling R-T11c), but not off one frozen in hitlag (UNVERIFIED), held, carried or inside Kirby, holding someone, trapped, intangible or invincible, or respawning. A fighter hanging on a ledge can be stood on and does not fall.
  - A counter lets every Final Smash through (SmashWiki "Unblockable attack"), and a windbox too (UNVERIFIED).
  - Landing during an aerial cargo throw lets the throw finish (UNVERIFIED).
  - The online engine-version bump went in Plan 5's first gameplay task (Task 2).
- Stick Jump is saved per port in the browser and travels in the online start config. The gamepad remap is saved per port too, but it is local only: only the packed input frame crosses the wire.
- Plan 6 rulings, as landed (D59, which records every one with its cost; UNVERIFIED where marked):
  - A right-stick flick keeps its direction in the buffer; out of shield it rolls, spot-dodges or up-smashes; Attack in shield grabs (SmashWiki "Grab", R-P6-14); in a hold a flick throws its way (UNVERIFIED, D1).
  - A smash input buffered with its press stays a smash (UNVERIFIED; it reverses Plan 5's "a buffered B is never a smash").
  - Samus's grab aerial attacks only; her tether recovery is carried (D3).
  - An aerial Final Smash ends with the fighter's own short hop (UNVERIFIED size, D4).
  - `SLOW_OPPONENT` is read as (rate, frames), stepped (UNVERIFIED-simplified, D5); a slowed fighter's presses wait in its buffer, which ages only on its own running steps.
  - The frozen, the trapped and a slowed fighter ride Smashville's platform (UNVERIFIED, D6).
  - The KO freeze stays, with presses buffered (D7); the Boomerang turns on the spot (D8).
  - Of two launches on one fighter in one step the stronger stands, whichever ports, and sets the freeze and the KO credit (UNVERIFIED, D9).
  - Every port stands on one idle phase, so standing fighters breathe in step in 3D.
  - A CPU holding a travelling Final Smash past 1,200 frames goes to point blank and fires at a catchable target (CPU judgement, UNVERIFIED, D10); the other Final Smashes keep Plan 5's firing rules, Critical Hit included (R-P6-15, R-P6-25).
  - Fighters are drawn over the stage's front face, the side camera stays, and shadows tip toward it (D11, D12).
  - Kirby alone is lifted onto the floor (0.57); Mario, Donkey Kong, Pikachu and Fox are carried (D13).
  - HUD portraits are rendered from the loaded model and never saved (D14).
  - Press-to-join (R-P6-11, narrowed by Task 30's ruling): a pad already driving a seat, the lone pad on P1 included, takes no other; with a keyboard player and one pad, the pad also drives P1, so P2 is set to a human in the menu or a second pad joins.
  - The online lobby says when it is loading the game data, and a direct link that cannot open fails in about 15 s with its own sentence (Task 40b).

## Open questions for David

None blocks the start. Each plan follows a stated default until David says otherwise.

- **Plan 2:**
  - Is gravity applied on a jump's first frame? The plan uses the published formula, which assumes yes.
  - The pairing of the landing-lag fields.
  - UNVERIFIED shapes: full-hop rise split, walk-speed curve, landing-threshold `>=`.
- **Plan 3:**
  - The speed-up integrates whole reaction frames.
  - A list of UNVERIFIED numbers: ASDI, tech frames, ledge-trump lag, autolink details.
  - Should the replica's facing-aware shield go? Ultimate covers both sides.
  - Should the attacker's ×1.1 pushback decay be added?
  - The shield-break launch is not implemented.
  - The bundle cost of the generated scripts.
- **Plan 4:**
  - Is DK's SSBU size acceptable?
  - Delete the stray tracked `super-smash/anim-mario-land.png`?
  - Is Kirby's 7-capsule hurt set acceptable?
- **Plan 5:**
  - The Final Smash per-hit numbers (Zero Laser, Team Star Fox, Volt Tackle, Critical Hit) and every Final Smash box offset are UNVERIFIED stand-ins.
  - Should the right stick also offer Tilt Attack and Jump?
  - Smash Ball standby:
    - Which hits drop the ball? The plan uses any damaging hit.
    - What HP does a dropped ball have? The plan uses 40.
    - Does the power have no time limit? The plan says none.
    - Is the power lost on a KO? The plan says yes.
  - Should the wall-jump push, footstool reach/stun/push and their windows be play-tested before the deploy? The wall-jump heights are SmashWiki's.
- **Plan 6:**
  - A real-gamepad check of the pad remap, the right stick (standing, in the air, shielding, holding someone) and press-to-join.

## Executing

Use `superpowers:subagent-driven-development`, one fresh implementer and one reviewer per task, plan by plan. Never run two plans at once.

Each plan's header lists its scratch verification record and what could not be verified:
- Plan 4: everything that needs Blender.
- Plans 2–4: Plan 1's final online-page text, edited by symbol.
