# Making a character look like themselves

Everything one fighter's appearance is made of, and where each piece lives.

Read this before changing a character. It is the accumulated set of things that
have gone wrong here, and most of them are silent — the fighter goes on looking
plausible and slightly wrong, which is the hardest kind of bug to see.

## How a fighter is drawn

Since Plan 4 (DECISIONS [D57](../DECISIONS.md)), a fighter in a match is their
**SSBU model**, posed by **our own 2D clips** retargeted onto the model's
bones, and the simulation reads those same bones from integer tables **baked**
at build time. Five things stack:

| Layer | What it decides | Where it lives |
|---|---|---|
| **Model** | The body: proportions, textures, face | built on your machine by `pnpm models` into `public/models/` (git-ignored) |
| **Pose** | What the body is doing this frame | `src/render/poses/` shared, `chars/<id>/poses.ts` per fighter, retargeted by `src/render3d/retarget/` |
| **Move FX** | What the move paints over the model: plasma, rock, sparks, arcs | `src/render/chars/<id>/fx.ts`, on the 2D overlay |
| **Projectiles** | The fireball, the arrow, the bolt | `chars/<id>/fx.ts` → `projectiles` |
| **Rig** | The 2D figure: HUD portraits, stock icons, the magnifying glass — and the bone lengths and rest angles the clips are written against | `src/render/chars/<id>/rig.ts` |

The play page stacks three canvases: the stage's sky (2D), the 3D world
(WebGL: the stage, the fighters, their shields, hit sparks and KO blasts), and a
transparent 2D overlay on top (the HUD, port tags, move effects, projectiles,
the other particles, the KO flash, the magnifying glass).

### The model pipeline

```bash
pnpm models:fetch      # the .blend files and textures, at a pinned commit, SHA-256-checked, into .model-cache/
pnpm models            # Blender (portable, in .model-cache/tools/) exports, joins and optimises one glb per fighter
pnpm models:check      # what `pnpm run deploy` runs first: every glb present, unchanged, under 25 MiB, built
                       # against the committed skeletons by this pipeline, nothing in public/models/ git would take,
                       # and no model, texture, fetched file, gzip but the bake, or uncommitted file anywhere else
                       # in public/ (next build copies all of it)
```

The models come from Worldblender's Blender re-exports. **Nothing Nintendo made
is ever committed**: no `.blend`, no glb, no texture, nothing under
`.model-cache/` or `public/models/`, and no screenshot or capture of a model —
the repo is public, and a takedown of one file would take the whole repo down.
What is committed is numbers about the models: the manifest's sizes and
SHA-256s (`scripts/models/manifest.json`), which meshes are the fighter
(`scripts/models/meshes.json`), each skeleton's bone names, bind matrices and
hurt-capsule sizes (`src/render3d/skeletons/*.json`, read out of the `.blend`
files by a stdlib-only reader, `pnpm models:skeletons`, no Blender), and the
bake. `noRippedAssets.test.ts` refuses any tracked file whose name, or whose
size and hash, is a manifest file's, and any in a pipeline format, starting
with a model's or texture's magic number, or gzip but the bake
(`scripts/models/rippedFormats.mjs`).

**Without `pnpm models`, every fighter is a stand-in**: their own hurtbox
capsules on the same bones, in their port's colour, posed exactly as the model
would be. A model that fails to
load is a stand-in for that match only. The game, the sim and every test need
neither Blender nor the model cache: a fresh clone's `pnpm test` is green, and
the few checks of a local build skip.

### The retarget rule

A clip is still a list of 2D angles, and each angle now drives SSBU bones
(`src/render3d/retarget/map.ts`): the hip, spine, head, legs and feet keep
SSBU's own bind stance at the 2D rest pose and turn from it in the side plane;
the arms, whose bind pose is a T, are first hung straight down and then turned
to the 2D angle. Every bone a clip does not name keeps its bind pose and rides
along, and the limbs keep SSBU's lengths — which is the point: hitboxes hang
off the real limbs. The side view only ever shows the side plane, which is the
plane the clips are drawn in.

A per-fighter exception goes in `RETARGET_OVERRIDES` against a measured failure
(Link's and Marth's sword hand is turned a further 90°, because the model holds
the blade across the fist). A render-only turn of the head toward the camera
(`faceTurn.ts`) leaves every box bone where it is.

### The bake

`public/bake/roster.bin.gz` is every fighter × every motion × every frame of
the bones the sim reads, in Q12 integers, made by the same functions the
renderer runs each frame (clock, clip sample, retarget, root transform). The
sim's limb hitboxes, the hurtboxes and the ECB all hang off it, and its
SHA-256 is part of the engine fingerprint online peers compare. Regenerate it
whenever a clip (`src/render/poses/**`, `chars/*/poses.ts`), a rig's bones or
scale, a skeleton, a fighter's moves or scripts, or the retargeter changes:

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`roster.test.ts` fails until you do.

### A clip edit is a gameplay edit now

Moving a limb in a clip moves the hitbox and hurtboxes that ride it. After any
clip change: re-bake, then run the ratchets and look at what moved —

```bash
pnpm vitest run src/fighters/acmd/reach.test.ts src/fighters/acmd/limb.test.ts src/game/hurtboxes.test.ts
# regenerate with UPDATE_REACH=1 / UPDATE_LIMB=1 / UPDATE_HURT=1, and review every changed row
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts   # then rewrite RULES_PIN.golden and say why
```

`reach.test.ts` compares every switched-on move's reach per frame and per
direction against the legacy box; an entry in `reach.allow.json` needs a class
and a reason. Check the move in the lab's contact sheet (below), where the
model and the sim's boxes are drawn together.

## What you own

Three files, and nobody else opens them:

```
src/render/chars/<id>/rig.ts      the 2D figure (portraits, stock icons) and the bones your clips are written against
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

Effects are painted on the 2D overlay, which sits in front of the 3D world, so
everything an effect paints is over the model. An effect may return
`{ hideFigure: true }` to hide the model entirely (Kirby's Stone is the only one
that does). The effect's `x, y` is the fighter's feet on screen, moved by the
clip's own root offset exactly as the model is; its `height` is the model's head
(the top of its head capsule).

`over` defers a paint until the rest of the effect is down — for anything the
rest of the effect must not cover:

```ts
uair: ({ ctx, x, y, u, over }) => {
  glow(ctx, x, y - 3 * u, 2 * u, "rgba(255,240,180,0.5)");        // behind
  over(() => crescent(ctx, x, y - 3 * u, 2.4 * u, 0.5 * u, -2.6, -0.5));  // in front
},
```

Queue order is paint order, and the callback runs with the canvas state the
renderer left rather than the state at the point you called `over` — save and
restore inside it if it needs one. (With the 2D figure, `over` was what put a
paint in front of the body: Samus's drill had its centre occluded by Samus for a
whole round of iteration.)

`over` still lands *under* the port tag, which is readability a move graphic
should not bury. If your effect has to be legible
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

## The 2D figure: portraits, stock icons and props

The rig's capsules, props and palette no longer draw the fighter in a match
(the model does); they draw the HUD's head portraits and stock icons, the
character-select art and the magnifying glass, all from the same rig. What
follows is how that figure is painted.

### Custom props

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
| `vx` `vy` | Velocity, **world units per frame, already decoded**. `+x` is the way the fighter faces. A walk is around 1, a full run 2–3. |
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

## Two things a rig can declare

**`tagClearance`** — how far your silhouette reaches above your *skeleton*, in
rig units. Over the 3D world the port tag hangs a unit above the model's head
capsule; only without a bake is it placed from `rigHeight`, which measures bones
and the head circle and knows nothing about props, so a fighter whose
identifying shape sits on top of their head wore the tag on it. Four characters
hit this independently. Declare it and that fallback tag rises; leave it and
nothing changes.

**`extra`** — a fifth palette role, for a fighter with a surface the other four
cannot carry. Marth's cape is the case: it is a distinct colour from his tunic,
his trim and his boots, so it became a literal to stay legible — and a literal
does not follow a costume, which left the *red-caped* alt light blue. Set
`extra` on the palette, and on any alt that needs its own, then use `"extra"` as
a prop's `colour`. Unset, it falls back to `accent`.

Reach for a literal only when the colour must *not* follow the costume — Mario's
white gloves, Pikachu's black ear tips. If it should follow, it needs a role.

## Testing what you add

Break it on purpose, confirm the test goes red, restore it. That much is already
habit here. **The other half is to break the *caller*.**

A ten-round review of the second art pass found twenty-one defects and fifteen
were in the tests, not the code — every implementation had been mutation-tested
and not one test had. They failed the same way each time: **the test named the
property it was failing to check.**

- `expect(Array.isArray(result.over)).toBe(true)` — for a test whose whole
  purpose was that the queue *survives*. `[]` is an array, and `[]` is the exact
  loss it described.
- Rewritten to count canvas calls, it passed on `save()`/`restore()`, which move
  a call count without painting a pixel.
- Every test of a shared helper called the helper directly, so all of them
  stayed green when a caller reverted to its own copy of the formula — which is
  the drift that caused the bug in the first place.
- A shape assertion read `moveTo`/`lineTo` when the helper draws neither, so it
  took `Math.max()` of an empty list.
- A loop over a projectile table that was empty ran zero assertions.

Three habits that catch all of those:

1. **Assert the value, not the shape.** `Array.isArray`, `.toBeDefined()` and
   `.not.toBe(somethingElse)` are the tells.
2. **Assert the fixture is non-empty** before trusting a loop over it. A loop
   over nothing is green.
3. **Delete the consumer, not the function.** If your test still passes, it
   proves a helper exists that nobody is obliged to call.

The question to ask of a green test: *what would still be broken while this is
passing?*

## Looking at your work

```bash
npm run dev                                            # once

# The pose, frame by frame, at the action's true length: the model (or its
# stand-in) in every cell, with the sim's hitboxes (red) and hurtboxes (yellow).
node scripts/animsheet.mjs attack --fighter link --move fsmash --out /tmp/x.png

# The move as actually played: projectile, hit spark, the opponent flinching.
# Drives a real match and hand-cranks the clock.
node scripts/fightsheet.mjs --fighter link --move fsmash --out /tmp/y.png
node scripts/fightsheet.mjs --fighter samus --move neutralB --frames 0,8,16,24,32
```

Also `http://localhost:3000/anim` interactively: the same contact sheet, one cell
per simulation frame, for any fighter and action. It is the one place a clip's
limbs and the boxes that ride them are drawn together, so it is where a clip
edit is checked. Without `--out`, captures land in the git-ignored
`test-results/anim/`: a picture of a real model is as unshippable as the model,
so never commit one, wherever it was written.

**A screenshot is the deliverable, not the check.** Look at it. If you cannot
say which frame is the contact frame, neither can a player.

## Reference

- **Frame data** — <https://ultimateframedata.com/smash> is the reliable one:
  startup, active frames, FAF, landing lag per move per character.
- **Hitbox visualisation** — <https://rubendal.github.io/ssbu/#/Character> and
  <https://github.com/RSN-Bran/ultimate-hitboxes>.
- **Models** — <https://gitlab.com/Worldblender/smash-ultimate-models-exported>,
  which `pnpm models:fetch` fetches at a pinned commit (never committed here).
- SmashWiki per-character pages for what each move *is* — the name and the
  motion, which is what you are drawing.

Frame data tells you *when*. It does not tell you what the move looks like, and
that is the part being fixed. Find the motion, then let `strike` place it.

## The bar

The question is not "is this better". It is **would someone who plays Ultimate
name this character from a still frame of this move.** Silhouette first, motion
second, colour last.
