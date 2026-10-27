# David-Smash rebuild: roadmap (2026-10-24)

Five implementation plans turn the `super-smash` replica into **David-Smash**: SSBU-shaped engine, published combat numbers, 3D models, online play, hosted free on Cloudflare.

- **Why:** `../specs/2026-10-24-david-smash-design.md` (requirements, David's decisions).
- **Evidence:** `../../../research/rebuild-2026-10/README.md` (repo analysis, physics gap table, compute budget, hosting comparison).

**Status: planned, not executed.** Each plan was drafted and replayed task by task in a scratch copy of the repo, then reviewed independently and revised. Nothing has been committed, deployed or installed.

## Order

Run the plans strictly in this order. Each plan is written against the code the previous one leaves, and each one cites the earlier plans' interfaces by symbol.

| # | Plan | Tasks | Decision | What ships |
|---|---|---|---|---|
| 1 | [Hosting, online, rename](2026-10-24-plan-1-hosting-online-rename.md) | 27 | D54 | David-Smash on a Cloudflare Worker (`https://david-smash.leaders-game.workers.dev`), with two-player online over WebRTC + TURN, gamepads, the Vercel copy removed and links switched |
| 2 | [Engine architecture](2026-10-24-plan-2-engine-architecture.md) | 29 (0–28) | D55 | `fighter_param.prc` params, Kinetic energies, Status pre/main/exec/end, ACMD `game_` scripts imported for all 8 fighters, plus correct jump arcs, air friction, walk/run, landings and a first ECB |
| 3 | [Combat fidelity](2026-10-24-plan-3-combat-fidelity.md) | 21 | D56 | Speed-up hitstun, Sakurai angle, DI/LSI/SDI, shields, perfect shield, staling, KB stacking, tech, glancing blows, grabs, ledge trump, and 38 root-bone scripts live |
| 4 | [3D renderer](2026-10-24-plan-4-3d-renderer.md) | 23 | D57 | three.js renderer with SSBU models (fetched locally, never committed), clips retargeted, bones baked into integer tables, per-bone hurtboxes, SSBU sizes, and 53 limb-bone slots live |
| 5 | [Specials, Final Smash, CPU, controls](2026-10-24-plan-5-specials-final-smash-cpu.md) | 23 | D58 | Charge-on-B, Reflector, Cape, Counter, F.L.U.D.D., Cargo Carry, Inhale/Copy, wall jump, footstool, crawl, throws/pummels and smash attacks on their scripts, eight Final Smashes with the Smash Ball, a CPU that techs, escapes, parries and uses specials, Stick Jump and gamepad remap |

`ENGINE_RULES_VERSION` goes 3 (Plan 3) → 4 (Plan 4) → 5 (Plan 5). Online peers on different versions refuse to play each other, so both players must reload after a deploy.

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

Plans 2 and 3 do not deploy. Their changes go live with the next deploy David approves.

## Decisions the planner made (confirmed when David approves the plans)

- Commit the research folder, the generated rubendal `game_` scripts (about 284 KB), the 8 derived skeleton JSONs and the bone bake (1.58 MB gzipped). No Nintendo-ripped file (`.blend`, `.glb`, textures) is ever committed; a git guard enforces this.
- Interim online without a card: STUN-only if Cloudflare TURN asks for billing.
- Do not ship another session's uncommitted David-Internet edits along with the relink.
- `Btn.Soft` (soft-stick button) lands in Plan 1. Online v1 has no rematch: both players return to the lobby.
- On an engine-fingerprint mismatch, the guest tells the host and both see the error.
- Fighters use SSBU model sizes; the legacy invented sizes are only the no-model fallback. Hurtboxes, ECB and reach change (DK grows from 15.0 to 26.3 units tall).
- Blender is portable, inside `.model-cache/tools/`. Skeletons are read without Blender, so only the glb export needs it.
- No bloom and no facial-expression swaps. Fighter `scale` scales limbs and hurtboxes, not ATTACK sizes.
- The screenshots in `docs/` are regenerated in 3D.
- Plan 5 rules (marked UNVERIFIED):
  - A footstool skips anyone grabbed, carried, trapped, respawning, on a ledge or in hitstun.
  - Counters ignore Final Smashes and windboxes.
  - Landing during an aerial cargo throw lets the throw finish.
  - The online engine-version bump goes in Plan 5's first gameplay task.
- Gamepad remaps and Stick Jump are saved per port in the browser and carried into online matches.

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

## Executing

Use `superpowers:subagent-driven-development`, one fresh implementer and one reviewer per task, plan by plan. Never run two plans at once.

Each plan's header lists its scratch verification record and what could not be verified:
- Plan 4: everything that needs Blender.
- Plans 2–4: Plan 1's final online-page text, edited by symbol.
