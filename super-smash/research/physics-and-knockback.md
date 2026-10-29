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

The result is then multiplied by rage and crouch cancel (0.85). The `1.4` and `+18`
constants have not changed since Melee. **HIGH**

A meteor on a grounded victim is **not** a knockback multiplier: it is a floor bounce.
Grounded targets "immediately bounce off the ground they're standing on (as long as they
deal enough knockback to put the opponent into tumble), reducing the knockback received by
20% [*Melee*, *Smash 4*]/15% [*Brawl*]/5% [*Ultimate*]" ([Meteor smash](https://www.ssbwiki.com/Meteor_smash),
revision 2047089), and "Landing a meteor smash or spike on a grounded opponent counts as a
bounce" ([Knockback](https://www.ssbwiki.com/Knockback), revision 2063895). So the old
"0.8" is the *Melee* and *Smash 4* figure for the same bounce, and *Ultimate*'s is a 5%
loss. The engine models it once, as the launch fires, for every tumbling launch that points
into the floor on a grounded victim, whether or not its box is marked a meteor (a meteor
smash or a spike, in the page's words; the plan's final wave widened it from meteors
alone): Task 12's floor bounce, which keeps 0.9 (the param `damage_fly_reflect_d_speed_mul`;
SmashWiki's 95% is the disputed alternative), and only if the victim still stands on a floor
once the freeze's SDI and ASDI have shifted it. The hitstun is the hit's own: "the amount of
hitstun delivered by a meteor smash is not affected by the knockback reduction" (Meteor
smash), and the page that gives the mid-flight bounce its 0.8 says "Characters bouncing off
surfaces due to knockback have their hitstun reduced by 0.8× relative to the initial amount,
with the exception of grounded meteor smashes" ([Hitstun](https://www.ssbwiki.com/Hitstun)).
Set knockback bounces too; a meteor too weak to tumble does not bounce, and the victim
flinches where it stands. No tech: "meteor smashes done on grounded-standing characters can
no longer be teched" (Meteor smash). rubendal's `Knockback.bounce` / `parameters.bounce` 0.8
is dead code at the pinned commit (its only call, `multiworker.js:212`, is commented out);
its live `Distance` sim bounces off a floor at 0.9 for a tumbling launch, as Task 12 does.
UNVERIFIED: that the hitstun exception covers a launch into the floor that is neither a
meteor smash nor a spike, and that the bounced launch keeps the balloon speed-up and set
weight's fall a mid-flight bounce disarms. **MED** (Plan 3, Task 16b fix round 1; the
exception's source, the final wave)

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
- **Set knockback is harder to modify, not weightless.** Rage, crouch cancel, launch
  rate and smash-charge bonuses no longer touch set-knockback moves: "In *Ultimate*, the
  effect of both types of knockback modifiers on set knockback was removed altogether"
  ([Knockback](https://www.ssbwiki.com/Knockback), Set knockback, revision 2063895), and
  rage "no longer applies to attacks that use set knockback" ([Rage](https://www.ssbwiki.com/Rage),
  revision 2065362). **HIGH** But the knockback is not a flat number: "If the move has a
  fixed knockback value set, then **d** is set to that value, and **p** is always 10", and
  "While damage is not a factor for set knockback, the character's weight still is" (same
  page). The formula is therefore
  `KB = ((((1 + fkb/2) · (200/(w+100)) · 1.4) + 18) · kbg/100) + bkb`, which is rubendal
  SSBU-Calculator's `WeightBasedKB`
  ([js/formulas.js](https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/formulas.js#L211-L213)):
  weight and growth count, the victim's percent and the hit's damage do not. A pummel's
  fkb 30 / kbg 100 is 40.63 against Mario (98) and 37.06 against Bowser (135). Set
  knockback never gets the balloon speed-up (rubendal `tumble && !isFKB`; "Moves with set
  knockback retain traditional knockback physics"). **HIGH** (Plan 3, Task 16b)
  Crouch cancel on set knockback is disputed: the wiki sentence above says Ultimate removed
  it, but rubendal multiplies its crouch-cancel factor into `WeightBasedKB` as into the
  scaling formula. The engine follows the wiki and leaves it off. **MED** (see Open
  questions)
- **Set weight** (`set_weight`) makes every victim weigh 100 in either formula, and in
  *Ultimate* its launch gets "a fall speed of 1.5 and gravity of 0.087 for the first 10
  frames of the launch, before reverting back to a fighter's regular fall speed and
  gravity. Notably, this effect overrides the homogenised fall speed and gravity used by
  attacks which have an angle between 70˚ and 110˚" ([Knockback](https://www.ssbwiki.com/Knockback),
  Weight-independent knockback). So a set-weight launch is never balloon fall. **HIGH**;
  what ends those 10 frames early (the hitstun running out, a landing) is not published,
  and the engine ends them with the launch (UNVERIFIED). (Plan 3, Task 16b)
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

`hitstun = floor(max(knockback × 0.4, 5)) − 1`: never under **4** frames. The 0.4 has held
since Melee; Ultimate always subtracts the extra frame. **HIGH** —
[Hitstun](https://www.ssbwiki.com/Hitstun); rubendal SSBU-Calculator `Hitstun`.

Tumble begins when the reaction frames, hitstun + 1, reach **32**: knockback **80**, hitstun
31. **HIGH** — rubendal SSBU-Calculator and the reference port's `isTumble`
(`floor(kb × 0.4) − 1 + 1 ≥ 32`); [Tumbling](https://www.ssbwiki.com/Tumbling). An earlier
revision of this document read the threshold as 32 frames of hitstun, about 82.5 knockback;
Plan 3 Task 6 moved the engine to 80.

During tumble, launch speed starts at **0.03×** the knockback and decays **0.051** per
frame. A tumbling launch without set knockback is also played back faster at first: the
balloon speed-up (`init_damage_speed_up`; rubendal `InitDamageSpeedUp` and
`ReactionFrameMulSpeedUp`) runs it up to **6×** on its first frame (from 80 reaction frames;
none at 30 or fewer), falling to 1× once 70% of its reaction frames are spent. So 90, 145,
200 and 250 knockback hold the victim 33, 41, 49 and 61 real frames (Hitstun), and the
`(knockback − 200) × 0.25` slope above 200 is that schedule's 6× cap, not a rule of its own.
**HIGH** (Plan 3, Tasks 5 and 6; DECISIONS D56)

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

### Shield damage, size and breaking

A hit takes **×1.19** of its damage off the shield, and the shield shrinks to
`(HP/50) × 0.85 + 0.15` of its radius, so a worn one can be poked
([Shield](https://www.ssbwiki.com/Shield)). A shield break stuns for **`400 − percent`**
frames ("From Brawl onward, the formula is changed to 400 − p",
[Stun](https://www.ssbwiki.com/Stun)), shortened 5.4 frames per button press and 3 per stick
input, then 33 frames of FuraFuraEnd (same page); the shield comes back at **37.5** HP
(SmashWiki "Shield break"). **HIGH** (Plan 3, Task 9) An earlier revision of this document
could not find these, and the engine used a 240-frame stand-in and full damage until then.

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

## Open questions

- **Crouch cancel on set knockback.** SmashWiki "Knockback" (Set knockback, revision
  2063895) says Ultimate removed every knockback modifier from set knockback; rubendal
  SSBU-Calculator applies its crouch-cancel factor (0.85) to `WeightBasedKB` too
  (`js/global.js` L645, L706 at `233590e9`). The engine leaves it off. **MED**
- **A grounded meteor's release bounce.** It happens as the launch fires and keeps the hit's
  whole hitstun: SmashWiki "Meteor smash", and "Hitstun", whose 0.8 bounce reduction is "with
  the exception of grounded meteor smashes". What no page says is what the bounced launch
  keeps. Here it keeps the balloon speed-up and set weight's fall, which a mid-flight bounce
  disarms (`kineticReflect`), because it is the launch itself and not a second one. And every
  tumbling launch into the floor on a grounded victim takes the same bounce and the same
  uncut hitstun, though the page's exception names meteor smashes (a spike counts as a
  bounce, SmashWiki "Knockback", but a 315° box is neither). **MED**
- **The floor bounce's speed loss.** The param `damage_fly_reflect_d_speed_mul` and
  rubendal keep 0.9; SmashWiki gives a 5% loss for Ultimate. The engine keeps 0.9. **MED**
- **The end of set weight's 10 frames.** The engine ends them early with the launch (the
  hitstun running out, a landing, a bounce, a grab); the wiki only says "the first 10
  frames of the launch". **MED**

## Citations

- [Knockback](https://www.ssbwiki.com/Knockback) ·
  [Hitstun](https://www.ssbwiki.com/Hitstun) ·
  [Tumbling](https://www.ssbwiki.com/Tumbling) ·
  [Rage](https://www.ssbwiki.com/Rage) ·
  [Hitlag](https://www.ssbwiki.com/Hitlag) ·
  [Meteor smash](https://www.ssbwiki.com/Meteor_smash)
- [Shield](https://www.ssbwiki.com/Shield) ·
  [Shieldstun](https://www.ssbwiki.com/Shieldstun) ·
  [Perfect shield](https://www.ssbwiki.com/Perfect_shield) ·
  [Stun](https://www.ssbwiki.com/Stun)
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
