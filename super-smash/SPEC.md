# Super Smash — Specification

> **eight fighters, one keyboard, sixty frames a second**

A browser rebuild of **Super Smash Bros. Ultimate**'s versus mode, played on a laptop
keyboard. The menus, the HUD and the physics are reproduced from measured values rather
than approximated by feel; the fighters are drawn from code rather than from art files,
because there is no legitimate way to obtain Nintendo's.

This document is the contract the implementation was built against. Decisions and their
reasoning live in [`DECISIONS.md`](DECISIONS.md); the evidence behind them is in
[`research/`](research).

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Frame** | One simulation tick. The game runs at a fixed 60Hz; every duration in this spec is a whole number of frames. |
| **Fixed** | A Q12 fixed-point integer — the real value times 4096. Every quantity the simulation branches on is one of these. |
| **Percent** | A fighter's accumulated damage. Higher percent means further launch, not less health. |
| **Knockback** | The launch distance a hit produces, from the formula in §4. Not the same as damage. |
| **Hitstun** | Frames after a hit during which the victim cannot act. Derived from knockback. |
| **Hitlag** | Frames during which *both* fighters freeze on contact. The impact "crunch". |
| **Tumble** | The helpless spinning state entered above 32 frames of hitstun. |
| **Stale** | A move used recently deals less damage. Ultimate barely reduces its knockback. |
| **Stock** | A life. Losing all of them ends your match. |
| **Blast zone** | The rectangle outside which a fighter is KO'd. |
| **DI** | Directional Influence — holding a direction at the moment of launch to bend the angle by up to 9.74°. |
| **Rollback** | Netcode that predicts the remote input, then rewinds and re-simulates when the guess was wrong. |
| **Port** | A player slot, 0–3. Determines HUD colour: P1 red, P2 blue, P3 yellow, P4 green. |

---

## 2. Scope

**In:** the Smash mode — a stock or timed brawl between 2–4 humans and CPUs, on a legal
stage, with Final Smashes via the Smash Ball. This is the mode that has carried across
every game in the series and is the one nearly everybody plays.

**Out, deliberately:** Spirits, World of Light, Classic Mode, Squad Strike, Tourney,
Home-Run Contest, amiibo, challenges, the Vault, unlockables, and **every item except the
Smash Ball**. Cutting these is what makes a faithful versus mode reachable — see
DECISIONS D1.

---

## 3. Architecture

Hexagonal, matching its sibling projects, with one addition that is not optional here: the
simulation is a **pure function**, and nothing else in the codebase is allowed to reach
into it.

```
   ┌──────────────────────────────────────────────────────┐
   │  app/            routes, the game shell               │
   │  components/     menus, CSS, stage select, HUD (React)│
   └───────────────┬──────────────────────────────────────┘
                   │ reads state, sends inputs
   ┌───────────────▼──────────────────────────────────────┐
   │  render/        canvas painter, camera, VFX           │
   │  audio/         Web Audio synthesis                   │
   │  ai/            CPU input generation                  │
   │  net/           rollback session + transport port     │
   └───────────────┬──────────────────────────────────────┘
                   │ step(state, inputs) -> state, events
   ┌───────────────▼──────────────────────────────────────┐
   │  engine/        THE SIMULATION — pure, deterministic  │
   │  fighters/      roster data                           │
   │  stages/        stage geometry                        │
   └──────────────────────────────────────────────────────┘
```

**The rule that makes the rest work:** `engine/` imports nothing from `react`, `next`,
`render/`, `audio/`, `net/` or `app/`, and calls no browser API at all. It is enforced by
`src/engine/layering.test.ts`, which walks the import graph and fails the build on a
violation — the same guard the sibling projects use, and here it protects determinism
rather than just tidiness.

### The simulation contract

```ts
function step(state: GameState, inputs: InputFrame[]): { state: GameState; events: StepEvents }
```

Four rules, all enforced by tests:

1. **No `Math.random`.** Randomness comes from `nextRandom(state.rngSeed)`, whose seed is
   part of the state and therefore rolls back with it.
2. **No `Date.now`, no `performance.now`.** Elapsed time is `state.frame / 60`.
3. **No `Math.sin/cos/tan/pow/exp/log/atan2`.** These are permitted to differ between
   engines in their last bits. Trigonometry comes from the integer table in `fixed.ts`.
4. **No mutation of the input state.** `step` returns a new state; the caller owns both.

Cosmetic state — particles, screen shake, audio — is derived from the returned `events`
and lives outside `GameState`, so re-simulating eight frames after a rollback does not
replay eight frames of explosions.

---

## 4. Physics and combat

Every formula below is the real one, cited in `research/physics-and-knockback.md`.

**Knockback**

```
KB = ((((p/10 + p·d/20) · (200/(w+100)) · 1.4) + 18) · s) + b
```

`p` = victim's percent after the hit · `d` = damage dealt · `w` = victim's weight ·
`s` = knockback growth ÷ 100 · `b` = base knockback. The result is then multiplied by
rage, crouch-cancel (0.85), and the grounded-meteor penalty (0.8).

**Hitstun** `floor(KB × 0.4) − 1`. At ≥ 32 frames the victim tumbles.

**Rage** `1 + ((percent − 35) / 115) × 0.1`, active from 35%, capped at 150% and 1.1×.
Applies to knockback only, and never to set-knockback moves.

**Hitlag** `floor((damage × 0.65 + 6) × electric × shielding)`, capped at 30 frames.
Electric hits are 1.5×; hitting a shield is 0.67×.

**Shieldstun** `floor(0.8 × damage × type × move × projectile + 2)`, capped at 60 frames.
Type is 0.725 for smashes, 0.33 for aerials, 1 otherwise; projectiles take a further 0.29.

**Shield** 50 HP, decaying 0.15/frame while held and regenerating 0.08/frame while not.
**Perfect shield is on release, not press** — a 5-frame window inside the 11-frame drop
animation, which is one of Ultimate's defining changes and is implemented as such.

**Ledge intangibility** `floor(60 × (airTime/300) + 64 − (percent/120) × 44)`, bounded to
[24, 124]. Six regrabs before a forced get-up; taking a hit resets the count.

**1v1** In a two-player match, damage taken is multiplied by 1.2.

**Short hop** Aerials from a short hop deal 0.85× damage, and therefore less knockback.

**Jumpsquat** 3 frames, universally.

---

## 5. Determinism and netcode

The simulation is deterministic by construction (§3), which buys rollback.

- **Transport is a port.** `net/transport.ts` defines `send(bytes)` / `onMessage(cb)`.
  Three adapters implement it: **WebRTC** (`trystero`, for real play), **BroadcastChannel**
  (two tabs on one machine, for development and for a second local window), and **loopback**
  (tests). The rollback session never learns which one it has.
- **Input packets** carry a window of the last 10 frames of input keyed by absolute frame
  number, over an *unreliable, unordered* DataChannel (`ordered: false, maxRetransmits: 0`).
  A dropped packet heals itself 16ms later when the next one arrives carrying the same
  frame again, which is cheaper than asking for a retransmission that would arrive too late
  to matter.
- **Prediction** repeats the opponent's last known input, capped at 8 frames ahead. Beyond
  that the local simulation stalls rather than guessing further.
- **Input delay** of 2 frames by default, so a good connection rarely rolls back at all.
- **LAN comes free.** No code special-cases a local network: ICE gathers host candidates
  and prefers them automatically, so two laptops on the same WiFi negotiate a direct path
  without touching the open internet. That is the whole reason WebRTC was chosen over a
  relayed WebSocket.
- **Desync detection** hashes the state every 30 frames and compares; a mismatch is
  reported rather than left to manifest as two players seeing different winners.

---

## 6. Controls

Two schemes, both defined in terms of `KeyboardEvent.code` so they survive non-QWERTY
layouts.

| Action | Config 1 (arrows) | Config 2 (mirrored) |
|---|---|---|
| Move | `←` `→` `↑` `↓` | `W` `A` `S` `D` |
| Special | `A` | `←` |
| Attack | `D` | `→` |
| Jump | `W` | `↑` |
| Shield | `E` | `Shift` |
| Grab | `Q` | `/` |

**These two cannot be used at the same time on one keyboard**, and that is a property of
the layouts themselves rather than a bug: they are mirror images, so six physical keys
carry opposite meanings between them (`W` is P1's jump and P2's up; `←` is P1's left and
P2's special). A `keydown` event does not say whose finger caused it. They are therefore
**alternative presets a player chooses**, which is what "the same but flipped" asks for.
For two people on one laptop, a third preset on a disjoint key cluster is provided, and the
binding UI refuses a key another active player already holds. See DECISIONS D8.

**Deriving analog meaning from digital keys.** A keyboard has no stick magnitude, so the
distinctions Smash draws from *how far* and *how fast* the stick moved are recovered from
timing instead:

| Distinction | Rule |
|---|---|
| Step vs. dash | A tap is a small step; a held direction dashes and then runs. |
| Tilt vs. smash | Attack within 5 frames of a *fresh* direction press is a smash; otherwise a tilt. |
| Dash attack | Attack while already at run speed. |
| Short vs. full hop | Jump released within the 3-frame jumpsquat is a short hop. |
| Fast fall | Down pressed after the jump apex. |
| Drop through | Down pressed while standing on a soft platform. |
| SDI | Each fresh direction press during hitlag is one pulse — mashing works exactly as it does in the real game. |
| Directional air dodge | Shield in the air with a direction held. |

**Walking is not reachable, and that is correct rather than missing.** A key is *always a
full deflection*, and a fully-deflected stick in the real game dashes and then runs — a
walk requires a partial tilt, which no key can express. So a held direction dashes, and
micro-spacing comes from tapping, which produces a short step before the dash commits. The
same limitation is why an all-digital controller plays Smash the way it does.

**Tap jump defaults off.** On a stick you can push up 25% and get an up-tilt; a key is
always 100%, so with tap jump on, every up-tilt becomes a jump. Both schemes already give
a dedicated jump key. It remains a toggle.

---

## 7. Roster

Eight fighters, chosen to span the archetype space so the physics engine is actually
exercised — a heavyweight and a featherweight, a zoner and a rushdown, a multi-jumper and
a fast-faller.

| Fighter | № | Archetype | Weight | Notable |
|---|---|---|---|---|
| Mario | 01 | All-rounder | 98 | The baseline every other fighter is read against |
| Donkey Kong | 02 | Heavyweight | 127 | Cargo throw, giant punch |
| Link | 03 | Zoner | 104 | Bomb, boomerang, arrow — three projectiles at once |
| Samus | 04 | Charge zoner | 108 | Chargeable shot held between stocks |
| Kirby | 06 | Floaty | 79 | Six tapering jumps, lowest gravity here, ruinous back air |
| Fox | 07 | Fast-faller | 77 | Highest gravity in the game, reflector, frame-2 jab |
| Pikachu | 10 | Speed | 79 | Two-segment Quick Attack, tiny hurtbox |
| Marth | 13 | Sword spacer | 90 | Tipper — the blade's tip does markedly more |

Numbers are Ultimate's fighter numbers, which is what the character select screen orders
by. Per-fighter attributes and full movesets live in `src/fighters/`, sourced from
Ultimate Frame Data and SmashWiki.

---

## 8. Stages

Six stages, from the competitive legal list, with real geometry from Kurogane Hammer.

| Stage | Blast L/R | Blast T/B | Ledges | Platforms |
|---|---|---|---|---|
| Battlefield | ∓240 | 192 / −140 | ∓79.99 | 3 soft, triangular |
| Final Destination | ∓240 | 180 / −140 | ∓80 | none |
| Small Battlefield | ∓240 | 180 / −140 | ∓80 | 2 soft |
| Smashville | −229 / 230 | 190 / −115 | −69.05 / 70.25 | 1 soft, sweeping |
| Town & City | ∓230 | 195 / −118 | −81.78 / 83.22 | 3 soft, drifting |
| Pokémon Stadium 2 | ∓250 | 180 / −125 | ∓93.78 | 2 soft |

Every stage also has an **Ω form** (flat, Final Destination's geometry) and a **Battlefield
form**, exactly as the real game does — which is cheap, because the layouts are shared and
only the skin changes.

---

## 9. Screens

| Route | What it is |
|---|---|
| `/` | Title screen — "PRESS ANY BUTTON" over the wordmark |
| `/menu` | Main menu — the diagonal-slash tiles |
| `/rules` | Stock/time, count, Smash Ball, timer |
| `/stage` | Stage select, with the Normal / Battlefield / Ω toggle |
| `/fighters` | Character select — the portrait grid and player panels |
| `/play` | The match itself |
| `/results` | Placings, KOs, falls, self-destructs |
| `/controls` | The two schemes, and rebinding |

The flow is Ultimate's: **rules → stage → fighters → match → results**, with stage select
before character select, which is the order Ultimate uses and the previous games did not.

---

## 10. Visual design

The interface is reproduced from screenshots, and the values below were sampled from them
rather than guessed.

```css
--smash-red:      #AD0000;   /* the top banner */
--smash-red-lit:  #C10500;   /* its lighter edge */
--smash-yellow:   #FFD500;   /* the mode tab, selection outlines */
--panel-ink:      #090B0C;   /* panel borders */
--p1: #FE3636;  --p2: #3B7BFE;  --p3: #FFC61E;  --p4: #35C759;
```

Load-bearing details, all from the reference screenshots:

- **Everything is sheared.** Panels, tabs and the HUD are parallelograms, not rectangles.
  A ~12° skew is the single strongest signal that this is Smash.
- **The damage meter** is a sheared plate: angled portrait on the left, the percent in
  heavy italic numerals with the tenths noticeably smaller than the integer part, and a
  dark name bar beneath carrying the port colour.
- **The percent ramps** white → yellow → red → dark maroon as damage climbs toward 300,
  and shakes when hit.
- **Fighters are drawn, not blitted.** A bone hierarchy of capsules and circles, posed
  from keyframe data and rendered to canvas — see DECISIONS D2.
- **Type** is Anton for numerals and display, M PLUS Rounded 1c for menus — SIL Open Font
  License, chosen as the closest free analogues to Ultimate's proprietary faces.

---

## 11. Testing

- **Unit** — every formula in §4 against worked examples from the research, co-located as
  `*.test.ts`.
- **Property** (`fast-check`) — the invariants the formulas must satisfy: knockback rises
  monotonically with percent, a heavier fighter always travels less from an identical hit,
  fixed-point round-trips, DI never deviates beyond 9.74°.
- **Determinism** — the same seed and inputs produce an identical state hash, twice over;
  and a rollback of 8 frames reproduces the state that was never rolled back.
- **Layering** — `engine/` imports nothing forbidden, checked by walking the import graph.
- **E2E** (Playwright) — the full flow from title to results, both control schemes, and
  the screenshot capture behind `CAPTURE=1`.

---

## 12. Out of scope

Spirits, items other than the Smash Ball, World of Light, Classic Mode, online
matchmaking or ranking, replays, stage builder, amiibo, unlockables, Mii fighters, echo
fighters, stage hazards, and touch controls. The last is not an oversight: every control
in §6 is a physical key, and a phone has none.
