# Making a character look like themselves

Everything one fighter's appearance is made of, and where each piece lives.

Read this before changing a character. It is the accumulated set of things that
have gone wrong here, and most of them are silent — the fighter goes on looking
plausible and slightly wrong, which is the hardest kind of bug to see.

## The four layers

A fighter on screen is four things stacked, in the order they matter:

| Layer | What it decides | Where it lives |
|---|---|---|
| **Rig** | Proportion, palette, props — the silhouette | `src/render/chars/<id>/rig.ts` |
| **Pose** | What the body is doing this frame | `src/render/poses/` shared, `chars/<id>/poses.ts` per fighter |
| **Move FX** | What the move paints: plasma, rock, sparks, arcs | `src/render/chars/<id>/fx.ts` |
| **Projectiles** | The fireball, the arrow, the bolt | `chars/<id>/fx.ts` → `projectiles` |

Only the middle one is shared, and only by default.

## What you own

Three files, and nobody else opens them:

```
src/render/chars/<id>/rig.ts      the look
src/render/chars/<id>/poses.ts    the clips that are yours rather than everybody's
src/render/chars/<id>/fx.ts       what your moves paint, and your projectiles
```

Plus tests next to them. **Do not edit anything outside your directory**
without saying so — `poses/`, `rigKit.ts`, `fxKit.ts`, `skeleton.ts` and
`characterArt.ts` are shared, and a change there lands on seven other people
mid-flight. If you genuinely need one, say what and why in your report and let
it be made once.

## Writing a pose

Poses are authored in **degrees** and stored in radians via `P({...})`. Angles
are parent-relative, zero along the parent, **clockwise positive with the
fighter facing right**. For a leg, 180° hangs straight down, 150° swings it
forward, 210° back. For an arm, 90° points straight forward, 0° straight up.

```ts
export const poses: Partial<Record<PoseName, PoseClip>> = {
  fsmash: {
    loop: false,
    strike: 0.34,                       // the key that is the moment of contact
    keys: [
      { t: 0,    pose: P({ ... }), ease: "in" },     // wind-up: accelerate in
      { t: 0.34, pose: P({ ... }), ease: "out" },    // contact
      { t: 0.5,  pose: P({ ... }) },                 // follow-through
      { t: 1,    pose: P({ ... }) },                 // terminator, never drawn
    ],
  },
};
```

### Five things that have each cost a day

1. **`t = 1` is never sampled.** `poseTimeFor` divides `actionFrame` by the
   state's length and `actionFrame` runs `0..n-1`, so the last frame drawn is at
   `(n-1)/n`. A key at `t = 1` is what the clip converges *towards*. Put the
   last shape you actually want seen at `(n-1)/n` or earlier.

2. **`strike` is anchored to the real hitbox.** Name the contact key's `t` in
   `strike` and `poseTimeFor` stretches the wind-up and the recovery
   independently so the clip is at full extension on the frame the hitbox is
   live — whatever the frame data says. You do not need to count frames; you
   need the right *shape*.

3. **`ease` on a hit is not `smooth`.** `smooth` decelerates into the contact
   frame, which makes every attack read as putty. Use `in` on the wind-up span
   and `out` on the strike span. `hold` cuts — right whenever a shape must be
   legible for a fixed few frames rather than travelled through.

4. **The right foot's rest angle is negative.** Bone angles accumulate down the
   chain and the legs are *not* individually mirrored — the whole rig is
   mirrored once at draw time. `footR` rests at `-88°`. A pose that names
   `footL: -84` and `footR: 84` gives you one foot pointing backwards, and three
   separate people have shipped it.

5. **Rotation interpolates the short way round.** A key at 0 and a key at 360°
   are the same key.

6. **`spin` cartwheels the whole body, and that is almost never what you want.**
   It rotates the fighter in the screen plane, so a fighter who is supposed to
   pirouette instead tips onto their side. Two characters reached for it
   independently on multi-hit spinning moves and both had to back it out. A
   rotation the body cannot show is expressed as **successive keys stepping the
   limb chain round**, 90° at a time — that is how a chain of keys expresses a
   turn a single pair cannot. Link's Spin Attack gets 940° of blade path this
   way with no `spin` at all. Reserve `spin` for a body that genuinely tumbles:
   a tumble, a roll, a launched fighter.

### Body-level fields

`offsetX` / `offsetY` translate the whole fighter in rig units (+x forward, +y
up). `scaleX` / `scaleY` squash and stretch — `scaleY` scales about the feet,
`offsetY` is absolute and has to be repaid by folding the legs, in proportion to
leg length, or a tall fighter's feet leave the stage while a short one's sink
through it.

## Writing a move effect

```ts
export const fx: Partial<Record<MoveSlot, FxFn>> = {
  fsmash: ({ ctx, x, y, u, dir, frame, t }) => {
    // Screen space, pixels, feet at (x, y), `u` pixels to the world unit.
    // `dir` is +1 facing right, -1 left — multiply, never branch.
  },
};
```

Effects are painted **under** the fighter by default, and may return
`{ hideFigure: true }` to replace them entirely (Kirby's Stone is the only one
that does).

Under the fighter is the right default — a charge glow behind the body, a
shockwave at the feet — and the wrong one for anything the body is *inside* of.
Call `over` for those:

```ts
uair: ({ ctx, x, y, u, over }) => {
  glow(ctx, x, y - 3 * u, 2 * u, "rgba(255,240,180,0.5)");        // behind
  over(() => crescent(ctx, x, y - 3 * u, 2.4 * u, 0.5 * u, -2.6, -0.5));  // in front
},
```

Queue order is paint order, and the callback runs with the canvas state the
renderer left rather than the state at the point you called `over` — save and
restore inside it if it needs one. Samus's drill had its centre occluded by
Samus for a whole round of iteration, and every fighter's up air puts its
graphic exactly where the body already is.

`over` still lands *under* the port tag and the shield, both of which are
readability a move graphic should not bury. If your effect has to be legible
above the head, that is a reason to move it, not to fight the tag: Link's
boomerang spent two-thirds of its wind-up hidden behind his shoulder across two
rounds before it was solved authorially, by winding up above the head instead.

Available in `fxKit`: `circle`, `glow`, `polygon`, `crescent`, `armourWindow`,
`withAlpha`. `crescent` is the tapered blade sweep the real game puts on nearly
every strong attack.

The key is the **move slot**, and a typo is silent — the effect simply stops
being drawn. `chars.test.ts` checks every key names a move the fighter has, so
add your entry and run it.

## Writing a projectile

```ts
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  marioFireball: ({ ctx, u, age, dir, heading, charge, frame }) => { ... },
};
```

Keyed by the **projectile's def id** from `fighters/<id>.ts`, not by the move.
The context arrives translated to the projectile's position and *not* rotated —
a fireball tumbles, an arrow noses over as it falls, a bomb does neither, so the
rotation is yours to apply.

## Custom props

The shared `PropKind` table is thirty shapes and adding to it is an edit to a
file everyone lives in. For a shape only you will ever need, use:

```ts
{ kind: "custom", bone: "handR", at: 1, size: 3, colour: "accent",
  draw: (b, p, anim) => { /* normalised frame: +y along the bone, +x forward */ } }
```

### A prop that moves on its own

A prop is bolted rigidly to its bone, so by default it can only move when a pose
moves that bone. That is right for a shoulder pad and wrong for everything soft.
A tail reads as a tail precisely because it *doesn't* track the body — it lags,
overshoots and settles late — and none of that is a property of the skeleton, so
no pose can express it.

The third argument is what makes it possible:

| Field | What it is |
|---|---|
| `frame` | The global frame. A clock of your own, for idle sway and flicker. |
| `t` | 0..1 through the current action, `0` when there is no move on. |
| `vx` `vy` | Velocity, rig units per frame. **`+x` is the way the fighter faces.** |
| `airborne` | Off the ground — a tail hangs differently in a run than in a jump. |

`vx` is signed by facing, so a tail trails on `-vx` in both directions with one
line and no conditional. **Never branch on a direction in a prop painter**: the
frame is already mirrored for you, and a sign added here is a sign applied
twice.

```ts
draw: (b, p, { frame, vx }) => {
  const sway = Math.sin(frame * 0.11) * 0.13 - vx * 0.35;  // idle drift, plus stream
  ...
}
```

This is two inputs, not a simulation. It buys sway and streaming; it does not
buy real follow-through, and a prop that needs to overshoot a fast pose still
has to be authored to.

Paint with `b.fill(...)` / `b.line(...)`, **never** `ctx.fillStyle` directly:
the figure is drawn twice — once inflated in the outline colour for the rim, once
in body colours — and a painter that sets its own fill paints that colour into
the rim pass and punches a hole in the silhouette.

**The shared weapon props are too thin to see.** `sword` and `swordLong` are
about a 0.46-unit strip beside a 1.25-unit forearm — a scratch on the glass at
match scale. Link's agent found that fixing the *poses* alone shipped a swing
nobody could see, and reported replacing Falchion with a broad `custom` blade as
the single biggest silhouette change of the whole pass. Check any weapon at
match scale before concluding its animation is fine.

**A shape painted in the outline colour disappears.** It is drawn into the rim
pass and vanishes into the fighter's own edge. Kirby's Inhale mouth was
invisible for exactly this reason. If an effect paints dark-on-dark, it is
invisible, not subtle.

## Looking at your work

```bash
npm run dev                                            # once

# The pose, frame by frame, at the action's true length.
node scripts/animsheet.mjs fsmash --fighter link --move fsmash --out /tmp/x.png

# The move as actually played: swing arc, projectile, hit spark, the opponent
# flinching. Drives a real match and hand-cranks the clock.
node scripts/fightsheet.mjs --fighter link --move fsmash --out /tmp/y.png
node scripts/fightsheet.mjs --fighter samus --move neutralB --frames 0,8,16,24,32
```

Also `http://localhost:3000/anim` interactively, with onion skin and a scrubber.

**A screenshot is the deliverable, not the check.** Look at it. If you cannot
say which frame is the contact frame, neither can a player.

## Reference

- **Frame data** — <https://ultimateframedata.com/smash> is the reliable one:
  startup, active frames, FAF, landing lag per move per character.
- **Hitbox visualisation** — <https://rubendal.github.io/ssbu/#/Character> and
  <https://github.com/RSN-Bran/ultimate-hitboxes>.
- **Models** — <https://gitlab.com/Worldblender/smash-ultimate-models-exported>
  for proportion and silhouette.
- SmashWiki per-character pages for what each move *is* — the name and the
  motion, which is what you are drawing.

Frame data tells you *when*. It does not tell you what the move looks like, and
that is the part being fixed. Find the motion, then let `strike` place it.

## The bar

The question is not "is this better". It is **would someone who plays Ultimate
name this character from a still frame of this move.** Silhouette first, motion
second, colour last.
