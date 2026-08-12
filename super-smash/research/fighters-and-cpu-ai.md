# The roster, and how Smash's CPUs actually behave

Research lane 4. Fetched against `ultimateframedata.com`, `ssbwiki.com` and
`kuroganehammer.com` in August 2026. Per-move data lives in `src/fighters/`; this document
records the attributes, the sourcing hazards, and the CPU research that shaped `src/ai/`.

---

## 1. A sourcing trap worth knowing about

**Ultimate Frame Data publishes base (multiplayer, 1.0×) damage. Kurogane Hammer publishes
1v1-scaled (1.2×) damage.** Almost every damage discrepancy between the two sources is this
multiplier and nothing else. **HIGH**

This project stores **base values** and applies the 1.2× as a match-type modifier at
runtime, which is how the real game works — the multiplier applies to damage *taken* in a
two-player match. Storing scaled values would have double-counted it in 1v1 and
under-counted it in a four-player free-for-all.

## 1b. The trap that nearly poisoned the whole roster

**Ultimate Frame Data publishes no angle, no base knockback and no knockback growth.**

Its columns are startup / FAF / landing lag / damage / **shield lag** / **shield stun** /
shield advantage. Read that table expecting BKB and KBG — which the research brief for this
lane explicitly asked for — and you will find two plausible small integers sitting exactly
where you expect them. They are the shield numbers. The first fetch of Mario's forward
smash returned "BKB 11, KBG 12"; the true values are **25 and 99**. Every research lane in
this project hit the same trap independently. **HIGH**

Numbers that wrong would not crash anything. They would produce a game where every move
launches at the wrong angle for the wrong distance, and the only symptom would be that it
does not feel right.

The actual source used is the game's **decompiled ACMD scripts** at patch 13.0.1
(`rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json`), parsed by a
script rather than read by a model. **HIGH**

That dump also **does** carry hitbox coordinates — as X/Y/Z per bone, with the root bone's
forward axis on Z — which corrects an earlier assumption in this document that they are
unpublished anywhere. Root-bone hitboxes are therefore exact; only the animation-dependent
limb-mounted ones are estimated, and those carry `// POSITION: estimated` in the source.

### Corrections this sourcing forced

Each is now pinned by a test, and each contradicts something widely repeated:

- **Fox's up smash is frame 8, not frame 2.** "Frame 2" is UFD's *charge hold* note on the
  same row. His frame-2 move is the jab.
- **Fox's Reflector is frame 3** (reflecting from 4), not frame 1 — that is a Melee
  property that gets carried forward in write-ups.
- **Marth's dair tipper does not spike.** The meteor is a *separate* hitbox below and
  behind him, active on frame 11 only, dealing 15% against the tip's 14%.
- **Kirby does not have the worst air speed** (0.84, rank 85/89). He is *floaty* — gravity
  0.064 — which is a different stat.
- **Marth has no jab 3**, Pikachu's jab is a single loop, and Samus and DK have two-hit
  jabs. The schema's required-slot list excludes jab2/jab3 rather than forcing four
  invented moves into existence.

---

## 2. Attributes

All **HIGH**, from UFD's stats table and SmashWiki's attribute pages.

| Fighter | Wt | Walk | Dash | Run | Air | Gravity | Fall | FastFall | Traction |
|---|---|---|---|---|---|---|---|---|---|
| Mario | 98 | 1.155 | 1.936 | 1.76 | 1.208 | 0.087 | 1.5 | 2.4 | 0.102 |
| Donkey Kong | 127 | 1.365 | 2.09 | 1.873 | 1.208 | 0.085 | 1.63 | 2.608 | 0.123 |
| Link | 104 | 1.247 | 1.98 | 1.534 | 0.924 | 0.096 | 1.6 | 3.04 | 0.113 |
| Samus | 108 | 1.115 | 1.87 | 1.654 | 1.103 | 0.075 | 1.33 | 2.128 | 0.082 |
| Kirby | 79 | 0.977 | 1.9 | 1.727 | 0.84 | 0.064 | 1.23 | 1.968 | 0.116 |
| Fox | 77 | 1.523 | 2.09 | 2.402 | 1.11 | **0.230** | 2.1 | **3.36** | 0.115 |
| Pikachu | 79 | 1.302 | 1.98 | 2.039 | 0.957 | 0.095 | 1.55 | 2.48 | 0.132 |
| Marth | 90 | 1.575 | 2.255 | 1.964 | 1.071 | 0.075 | 1.58 | 2.528 | 0.114 |

Fox's gravity and fast-fall speed are **the highest in the game**, which is the whole
character: fastest short-hop pressure in the cast, and the easiest of the eight to combo
and kill early. Kirby sits at the opposite pole — third-lowest gravity, fifth-slowest fall,
and **six jumps** (one grounded, five aerial, each successively shorter, ~21.1 descending
to ~10.8).

Three facts that are easy to get wrong and were verified:

- **Ultimate's Link has no tether recovery.** The Breath of the Wild incarnation lost both
  the Hookshot and the Clawshot. An unused tether hitbox exists in his files but is
  unreachable. He also cannot wall jump. **HIGH**
- **Samus does** have one, via the Grapple Beam — and pays for it with a frame-15 grab and
  a 59-frame whiff recovery, against a normal grab's frame 6 and FAF 34.
- **Zelda and Sheik do not transform.** That split happened in Smash 4 over 3DS hardware
  limits, not in Ultimate. Neither is in this roster, but the mechanic is worth not
  building by mistake.

---

## 3. What makes each fighter itself

- **Mario** — nothing maxed, everything above average. His identity is frame data (2–16f
  startup across most of the kit) and combo density, not any single tool. The baseline the
  other seven are read against.
- **Donkey Kong** — subverts the slow-tank stereotype with above-average walk, dash and run.
  The identity is the **cargo grab**: all four throws execute from a carry state, turning
  one read into an extended edgeguard sequence. Pays with the worst disadvantage state
  here — a huge hurtbox and a purely horizontal recovery.
- **Link** — three simultaneous, mutually supporting projectiles (arrow, boomerang, remote
  bomb) controlling neutral, behind disjointed sword normals. His dair pogo-bounces and can
  hit twice.
- **Samus** — a heavy zoner. Charge Shot scales 5%→28% over ~112 frames and is **holdable
  indefinitely, stored across stocks**.
- **Kirby** — six jumps and the lowest fall speed make his recovery nearly unkillable, but
  he is among the easiest to launch. Elite grounded frame data (frame-2 jab, frame-4 tilts).
- **Fox** — frame-2 jab, frame-4 nair, frame-9 bair with an autocancel window so early it
  connects out of a fast-falled short hop. His Blaster is **transcendent and causes zero
  hitlag, knockback or flinch** — pure chip pressure, never a combo tool, which is a
  genuinely unusual property to model.
- **Pikachu** — the smallest hurtbox in the cast plus uniformly low startup and endlag.
  Quick Attack is two aimable dash segments where **the second must differ from the first
  by at least 30°** to register as a separate hit.
- **Marth** — the entire character is the **tipper**. Every attack carries a weak hitbox
  near the body and a markedly stronger one at the blade's tip (fsmash 13% vs 18%). Modelled
  as two hitboxes on the same frames, the outer one taking priority. His dair's meteor
  window is **frame 11 only**.

---

## 4. CPU AI

SmashWiki documents CPU behaviour qualitatively rather than numerically — **no per-level
reaction-time-in-frames or tech-rate figures exist in any source found.** What scales with
level 1→9: **HIGH** — [Artificial intelligence](https://www.ssbwiki.com/Artificial_intelligence).

- **Decision follow-through.** Level 1 "almost never" follows through and waits a long time
  before acting. Level 9 executes instantly with frame-perfect reactions.
- **Mash speed**, affecting grab escapes, shield-break recovery and waking from sleep.
- **Shielding and dodging.** Low levels barely defend. Levels 7–9 "almost always" do, with
  near-frame-perfect perfect shields — but **reactively**, triggered only when an attack
  input actually occurs nearby, never predictively.
- **Move selection.** Low levels stand next to you spamming a weak tilt; high levels use
  aerials, smashes and grabs.
- **Recovery.** Higher levels combine recovery options; lower levels use a narrow subset.

Implemented as composable behaviours scored per frame, with level tuning the weights, the
noise, and — most importantly — **how stale a view of the game state the CPU is allowed to
act on**. Reaction delay is modelled as acting on a delayed snapshot rather than as an
artificial handicap, so a level-1 CPU is genuinely slow to notice rather than arbitrarily
bad. The whole thing is a pure function threading the RNG seed, because CPU matches must
roll back identically to human ones.

### The documented flaws, which are half the character

These are real, catalogued exploits in the shipping game, and reproducing a few of them is
more faithful than an AI that plays perfectly. **HIGH** —
[Flaws in artificial intelligence](https://www.ssbwiki.com/Flaws_in_artificial_intelligence).

- CPUs freeze near the ledge and often **self-destruct trying to hit a ledge-camper**.
- They reliably **shield-grab** any attack that touches their shield, or any shield held
  near them for more than a few frames.
- They default to **air-dodging on landing**, making landings punishable on a read.
- They **shield when an opponent approaches from roughly two character-lengths** — a fixed,
  exploitable distance threshold.
- They **never mix up recovery options** within a match.
- They always throw a get-up attack when someone is nearby.
- Counter users trigger reactively on close approach, so baiting beats them consistently.

---

## Citations

- [ultimateframedata.com](https://ultimateframedata.com/smash) ·
  [stats table](https://ultimateframedata.com/stats.php)
- [Mario (SSBU)](https://www.ssbwiki.com/Mario_(SSBU)) ·
  [Donkey Kong](https://www.ssbwiki.com/Donkey_Kong_(SSBU)) ·
  [Link](https://www.ssbwiki.com/Link_(SSBU)) ·
  [Samus](https://www.ssbwiki.com/Samus_(SSBU)) ·
  [Kirby](https://www.ssbwiki.com/Kirby_(SSBU)) ·
  [Fox](https://www.ssbwiki.com/Fox_(SSBU)) ·
  [Pikachu](https://www.ssbwiki.com/Pikachu_(SSBU)) ·
  [Marth](https://www.ssbwiki.com/Marth_(SSBU))
- [Artificial intelligence](https://www.ssbwiki.com/Artificial_intelligence) ·
  [Flaws in artificial intelligence](https://www.ssbwiki.com/Flaws_in_artificial_intelligence)
- [Out of shield](https://www.ssbwiki.com/Out_of_shield) ·
  [Grab](https://www.ssbwiki.com/Grab) ·
  [Roll](https://www.ssbwiki.com/Roll) ·
  [Spot dodge](https://www.ssbwiki.com/Spot_dodge)
