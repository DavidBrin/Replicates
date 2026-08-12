# Ultimate's physics and combat maths

Research lane 1. Fetched against `ssbwiki.com` and `kuroganehammer.com` in August 2026.
Confidence tags: **HIGH** = directly quoted from a primary page. **MED** = derived or
cross-checked between sources. **LOW** = community consensus, unverified.

Everything here is implemented in `src/engine/knockback.ts` and
`src/engine/constants.ts`. The point of this document is that no number in the engine was
invented — each one has a source, and the few that are disputed say so.

---

## 1. Knockback

```
KB = ((((p/10 + p·d/20) · (200/(w+100)) · 1.4) + 18) · s) + b
```

`p` = the victim's percent **after** the hit lands · `d` = damage dealt, already adjusted
for staleness · `w` = the victim's weight (100 for weight-independent moves) ·
`s` = knockback growth ÷ 100 · `b` = base knockback. **HIGH** —
[Knockback](https://www.ssbwiki.com/Knockback).

The result is then multiplied by rage, crouch cancel (0.85), and a grounded meteor
penalty (0.8). The `1.4` and `+18` constants have not changed since Melee. **HIGH**

### Worked examples, used as engine tests

Mario's up smash — 19.6% damage, base knockback 32, knockback growth 94:

| Victim | Weight | Start % | Knockback |
|---|---|---|---|
| Bowser | 135 | 0 | 72.63 |
| Jigglypuff | 68 | 0 | 82.07 |
| Bowser | 135 | 60 | 145.2 |

These are asserted in `knockback.test.ts`. A lighter fighter travelling further from an
identical hit is the property test.

### What Ultimate changed

- **Staleness barely touches knockback.** The dampening factor is scaled to **0.3×** of
  its Smash 4 effect. A stale move still loses full damage; it keeps most of its launch
  power. **HIGH**
- **Set knockback is now immovable.** Rage, crouch cancel and the rest no longer modify
  set-knockback moves at all. **HIGH**
- **"Balloon knockback".** Launches between **70° and 110°** get a fixed falling speed of
  **1.8** during hitstun, and the old gravity-derived extra launch speed is not applied.
  Vertical launches therefore feel uniform across the cast regardless of individual
  gravity. **HIGH**

### A premise this research corrected

The commonly repeated "Ultimate applies a ~1.05× global knockback multiplier" **could not
be found in any primary source** — not SmashWiki, not Kurogane Hammer, not the patch
notes. It appears to be community folklore. The engine does **not** implement it. What
actually makes Ultimate hit harder is higher per-move tuning, the reduced staleness
dampening above, and faster overall movement. **MED** — an absence of evidence, stated as
such.

---

## 2. Hitstun and tumble

`hitstun = floor(knockback × 0.4) − 1`. The 0.4 has held since Melee; Ultimate always
subtracts the extra frame. **HIGH** — [Hitstun](https://www.ssbwiki.com/Hitstun).

Tumble begins at **≥ 32 frames of hitstun**, computed before modifiers. **HIGH** —
[Tumbling](https://www.ssbwiki.com/Tumbling). Note this is a *hitstun-frame* threshold,
not the "knockback > 80" rule of thumb that circulates; 32 frames back-computes to ≈ 82.5
knockback, close but not equal. The engine checks frames.

During tumble, launch speed starts at **0.03×** the knockback and decays **0.051** per
frame. Above 200 knockback the speed-up stops scaling and hitstun instead grows by
`(knockback − 200) × 0.25`. **HIGH**

---

## 3. Rage

```
rage = 1 + ((percent − 35) / 115) × 0.1
```

Active from **35%**, capped at **150%** and therefore at **1.1×** — down from Smash 4's
1.15×. Applies to knockback only, never to damage, and never to set-knockback moves.
**HIGH** — [Rage](https://www.ssbwiki.com/Rage).

---

## 4. Hitlag

```
hitlag = ⌊ ⌊ ⌊ (damage × 0.65 + 6) × moveMult × electric × shielding ⌋ × playerCount ⌋ × crouchCancel ⌋
```

**Three nested floors, not one**, and the nesting is load-bearing: crouch cancel scales a
frame count that has *already* been rounded, because the game works in whole frames at each
stage rather than in one continuous product. An earlier revision of this document flattened
it to a single floor while condensing, and a code reviewer duly cited the flattened version
against the (correct) implementation. Verified verbatim against
[Hitlag](https://www.ssbwiki.com/Hitlag). **HIGH**

Note that **shieldstun is a different shape** — `floor(0.8·d·t·m·p + 2)`, a single floor —
so the two formulas must not share a rounding helper. See DECISIONS D27.

Electric hits are **1.5×**; shielding is **0.67×**; crouch cancel is **0.67×** and applies
to *both* fighters. Capped at **30 frames**. A 15% move with no modifiers gives 15 frames
— up from 10 in Smash 4 and 8 in Melee, which is why Ultimate feels heavier on contact.
**HIGH** — [Hitlag](https://www.ssbwiki.com/Hitlag).

Both fighters vibrate in place during hitlag — horizontally when grounded, vertically when
airborne — with amplitude scaled by camera distance so it stays legible when zoomed out.
Hurtboxes do not move during the shake, so it cannot cause a phantom hit. **HIGH** —
Sakurai's Famitsu column, via
[sourcegaming.info](https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/).

---

## 5. Shields

| Property | Value |
|---|---|
| Shield HP | 50 |
| Decay while held | 0.15 / frame |
| Regen while released | 0.08 / frame |
| Shield drop | 11 frames |
| Minimum hold before dropping | 3 frames |

**HIGH** — [Shield](https://www.ssbwiki.com/Shield).

```
shieldstun = floor(0.8 · damage · type · move · projectile + 2)
```

`type` = 0.725 for smash attacks, 0.33 for aerials, 1 otherwise. Projectiles take a
further 0.29. **Capped at 60 frames — Ultimate is the only game in the series that caps
it.** **HIGH** — [Shieldstun](https://www.ssbwiki.com/Shieldstun).

### Perfect shield is on release

This is the single most commonly mis-implemented Ultimate mechanic and it is implemented
correctly here: a perfect shield happens when you **drop** shield within a **5-frame
window** of the 11-frame release animation, not when you raise it. Shield must have been
held ≥ 3 frames first, so the earliest possible perfect shield is frame 4. **HIGH** —
[Perfect shield](https://www.ssbwiki.com/Perfect_shield).

The reward is asymmetric, which is why it is worth modelling exactly: you act **3 frames
earlier** against a direct attack, **12 frames earlier** against a disjointed one, and
**8 frames *later*** against a direct projectile — perfect-shielding a projectile is worse
than just holding shield. **HIGH**

### Gaps

The **shield-break stun formula** could not be recovered. Sources agree it is inversely
proportional to the victim's percent and reducible by mashing, but no coefficients were
published, and `dragdown.wiki` — which likely has them — returned HTTP 403 on every
attempt. The engine uses 240 frames scaled by percent and mash input, which is a
**LOW**-confidence stand-in and is labelled as such in `constants.ts`.

Likewise, no source gave a shield-HP-damage-per-hit equation distinct from the shieldstun
formula. The engine treats shield HP loss as equal to the damage dealt, a commonly cited
simplification. **LOW**

---

## 6. DI, LSI and SDI

**DI** deviates the launch angle by at most **0.17 radians ≈ 9.74°**, achieved when the
input is perpendicular to the base trajectory. **MED** —
[Directional influence](https://www.ssbwiki.com/Directional_influence).

Sources disagree here and the disagreement is worth recording. SmashWiki's Smash 4
section — which Ultimate explicitly inherits — states DI was halved to 0.17 rad. A
figure of ~18° also circulates widely. The 18° is almost certainly the *pre-nerf*
Brawl-era value; 9.74° is what a direct fetch of the current page gives, with no later
reversion patch mentioned. The engine uses 9.74° and the test asserts the bound.

**LSI** multiplies launch speed by **1.095** for a full-up input and **0.92** for full
down, calculated on the last frame of hitlag. It does nothing between 65°–115° or
245°–295°, and nothing to knockback that does not cause tumble. **HIGH**

**SDI** moves the victim **2 units** per pulse, with **4 frames** minimum between
registered inputs. Every five consecutive hits taken increases the next five hits' SDI
distance by 1.15×. **HIGH** —
[Smash directional influence](https://www.ssbwiki.com/Smash_directional_influence).

Automatic SDI was heavily nerfed: it now applies only to electric, paralyze, crumple and
autoshift effects, and not to vertical knockback. Its exact magnitude was **not found**.

---

## 7. Ledges

```
intangibility = floor(60 × (airTime / 300) + K − (percent / 120) × 44)
```

`airTime` capped at 300 frames, `percent` capped at 120.

**This formula has a genuine source conflict, and the engine picks a side.** SmashWiki
gives `K = 44` and states a range of 23–123 frames — but those are arithmetically
inconsistent with each other (K=44 yields a maximum of 104, not 123). Kurogane Hammer
gives `K = 64` with a stated range of 24–124, which *is* internally consistent
(60 + 64 − 0 = 124). The engine uses **K = 64, bounded [24, 124]**. **MED** —
[Ledge](https://www.ssbwiki.com/Ledge),
[Kurogane Hammer formulas](https://kuroganehammer.com/Smash4/Formulas).

Other ledge rules, all **HIGH**:

- **Six regrabs** before a forced get-up; taking hitstun resets the counter.
- Intangibility from get-up options scales **×0.8** after the first regrab, **×0.5** after
  the second, and is **disabled entirely from the third**.
- Grabbing a ledge from behind reaches **40% less far**.
- Only one fighter may hold a ledge (Ice Climbers excepted).
- **Edge-hogging is gone.** Grabbing an occupied ledge *trumps* the holder off it.

---

## 8. Hitboxes

Hitboxes are **spheres and capsules**. **HIGH** — [Hitbox](https://www.ssbwiki.com/Hitbox).

The detail that actually matters for implementation: a hitbox occupies not only where it
is this frame, but **where it was last frame and every point in a straight line between**
— regardless of what the animation did in between. This is a swept capsule, and it is why
fast hitboxes in Ultimate never tunnel through an opponent. `src/engine/hitbox.ts`
implements the sweep rather than a point-in-time test. **HIGH**

**Clanking:** two opposing hitboxes within **9% damage** of each other both cancel and
rebound. Outside that range the stronger continues and the weaker is cancelled. Ultimate
adds that **neither fighter can be hit on the clank frame itself** — a surviving move can
only connect the following frame. Transcendent hitboxes never clank at all and simply pass
through. **HIGH** — [Priority](https://www.ssbwiki.com/Priority).

---

## 9. Ultimate-specific systems, consolidated

| System | Value |
|---|---|
| 1v1 damage multiplier | **1.2×**, on damage *taken*, two-player matches only |
| Short-hop aerials | **0.85×** damage, and therefore less knockback |
| Jumpsquat | **3 frames**, universally |
| Fast fall | +60% fall speed for most of the cast; a velocity *set*, not an acceleration |
| Dash interrupt | frame **15**, universally — this is what gave everyone a dash dance |
| Input buffer | **9 frames** |
| Shieldstun cap | **60 frames** |
| Hitlag cap | **30 frames** |
| Respawn platform | vanishes after 300 frames; minimum 60 frames of invincibility on leaving |
| Smash Ball | 40 HP, decaying 2 every 60 frames |
| Sudden death | everyone set to 300% |

---

## Citations

- [Knockback](https://www.ssbwiki.com/Knockback) ·
  [Hitstun](https://www.ssbwiki.com/Hitstun) ·
  [Tumbling](https://www.ssbwiki.com/Tumbling) ·
  [Rage](https://www.ssbwiki.com/Rage) ·
  [Hitlag](https://www.ssbwiki.com/Hitlag)
- [Shield](https://www.ssbwiki.com/Shield) ·
  [Shieldstun](https://www.ssbwiki.com/Shieldstun) ·
  [Perfect shield](https://www.ssbwiki.com/Perfect_shield)
- [Directional influence](https://www.ssbwiki.com/Directional_influence) ·
  [Smash directional influence](https://www.ssbwiki.com/Smash_directional_influence)
- [Ledge](https://www.ssbwiki.com/Ledge) ·
  [Kurogane Hammer formulas](https://kuroganehammer.com/Smash4/Formulas)
- [Hitbox](https://www.ssbwiki.com/Hitbox) ·
  [Priority](https://www.ssbwiki.com/Priority)
- [Jumpsquat](https://www.ssbwiki.com/Jumpsquat) ·
  [Short hop](https://www.ssbwiki.com/Short_hop) ·
  [1v1 multiplier](https://www.ssbwiki.com/1v1_multiplier) ·
  [Buffer](https://www.ssbwiki.com/Buffer)
