# Super Smash — Decision Log

Every non-obvious choice, with the reasoning that produced it. Written as the decisions
were made, not reconstructed afterwards — so the later entries include things that shipped
wrong first and were caught in review.

Backed by [`research/physics-and-knockback.md`](research/physics-and-knockback.md),
[`research/netcode-and-latency.md`](research/netcode-and-latency.md),
[`research/keyboard-controls.md`](research/keyboard-controls.md),
[`research/ui-and-visual-language.md`](research/ui-and-visual-language.md),
[`research/stages-and-rendering.md`](research/stages-and-rendering.md),
[`research/fighters-and-cpu-ai.md`](research/fighters-and-cpu-ai.md),
[`research/art-audio-and-licensing.md`](research/art-audio-and-licensing.md).

---

## D1 — Only the brawl, and only one item

**Decision.** Versus mode: 2–4 fighters, stock or timed, on a legal stage, with the Smash
Ball. No Spirits, no World of Light, no Classic Mode, no Squad Strike, no Tourney, no
amiibo, no challenges, no unlockables, and no items other than the Smash Ball.

**Why.** Ultimate is enormous, and almost none of that surface is what people mean when
they say they play Smash. The brawl is the mode that has carried across every game in the
series since 1999 and is the one every player has in common. Cutting the rest is what makes
the remaining part reproducible *properly* — real knockback maths, real frame data, real
stage geometry — rather than reproducing everything shallowly.

**Consequence.** The engine has no item system at all, only a bespoke Smash Ball. Adding
items later means adding a spawner, a pickup state and a throw state, none of which exist.

---

## D2 — Fighters are drawn from code, not from art files

**Decision.** Every fighter is a bone hierarchy of capsules and circles, posed from
keyframe data and painted to canvas. There are no sprites, no models, and no image assets
in the repository at all.

**Why.** There is no legitimate way to obtain Nintendo's art, so the only honest options
were commissioning original sprite work or generating everything. Generation also removes
the failure mode that has stopped nearly every open-source Smash clone: the engine gets
built, and then the project stalls forever on asset production
(`research/stages-and-rendering.md` §2 catalogues four of them).

**Rejected.** *Sprite sheets* — the highest visual ceiling, but needs an animator this
project does not have. *Physics ragdolls*, Stick Fight style — cheapest to build, but reads
badly for a fighting game, where the whole design language depends on parsing startup,
active and recovery frames at a glance. Authored key poses guarantee readable silhouettes;
emergent physics does not.

**Consequence.** Per-fighter variety comes from bone-length scaling, palettes and attached
props rather than from separate art, so adding a ninth fighter is a data file rather than a
commission.

---

## D3 — The simulation is fixed-point integers, and trigonometry comes from a table

**Decision.** Every quantity the simulation can branch on is a Q12 fixed-point integer.
`Math.sin`, `cos`, `pow`, `exp`, `log` and `atan2` are banned inside `engine/`, with
trigonometry served from an integer lookup table quantised at module load.

**Why.** Rollback requires that two machines stepping the same state with the same inputs
produce bit-identical results. Basic IEEE-754 arithmetic is specified tightly enough to be
safe — the folklore that "floats are non-deterministic" is overstated. The transcendental
functions genuinely are not: the standard marks them *recommended*, not required, so two
engines may legally differ in the last bits. A launch angle resolved through `Math.cos` is
exactly the kind of value that diverges silently over a few hundred frames and surfaces as
"that killed on their screen and not on mine".

The lookup table is not a hole in this. It is built with `Math.sin` once, but **quantised to
integers immediately**, and the gap between adjacent fixed-point values is around 200,000
times larger than the worst-case disagreement between two engines' `Math.sin`. Every engine
rounds to the same integer.

**Consequence.** Authoring data means writing `fx(1.208)` rather than `1.208`, and reading
it back for display means `toFloat()`. Slightly more ceremony, in exchange for a property
the whole netcode design depends on.

---

## D4 — Cosmetic state lives outside `GameState`

**Decision.** Particles, camera shake, and audio are driven by the `StepEvents` that
`step()` returns, and are not part of the simulation state.

**Why.** A rollback re-simulates up to eight frames in a single tick. If explosions and
sounds were part of the state, every correction would replay eight frames of them at once.
Keeping cosmetics outside also shrinks what has to be snapshotted, which makes saves
cheaper and removes a whole class of determinism bugs — a particle system seeded from
`Math.random` cannot desync a match it is not part of.

**Consequence.** The renderer and the audio engine are strictly downstream. Neither can
influence the game, which is also why neither needs to be deterministic.

---

## D5 — Ledge intangibility uses Kurogane Hammer's constant, not SmashWiki's

**Decision.** `floor(60 × (airTime/300) + 64 − (percent/120) × 44)`, bounded to [24, 124].

**Why.** The two sources disagree, and one of them disagrees with itself. SmashWiki gives
the constant as **44** and states a range of 23–123 — but K=44 yields a maximum of 104, not
123, so the page is internally inconsistent. Kurogane Hammer gives **64** with a stated
range of 24–124, and 60 + 64 − 0 = 124 exactly. The self-consistent source wins.

**Consequence.** If this is wrong, ledge play is uniformly slightly too safe. It is flagged
in `constants.ts` so the next person does not have to rediscover the conflict.

---

## D6 — There is no global knockback multiplier

**Decision.** Ultimate's knockback formula is implemented exactly as Melee's, with no extra
scalar.

**Why.** The research brief asked to implement a "~1.05× global knockback multiplier" that
Ultimate supposedly applies. It could not be found in any primary source — not SmashWiki,
not Kurogane Hammer, not the patch notes. It appears to be community folklore. What
actually makes Ultimate hit harder is higher per-move base knockback and growth tuning, the
reduced staleness dampening, and faster overall movement.

**Consequence.** An assumption that came in with the brief was dropped rather than
implemented. Recorded here because "we checked and it does not exist" is a finding, and a
silently-implemented phantom constant would have made every KO percentage subtly wrong.

---

## D7 — Tilt versus smash is a timing window, because a key has no magnitude

**Decision.** An attack pressed within **5 frames of a fresh direction-key edge** is a
smash attack. Otherwise it is a tilt. Walk becomes dash after **3 frames** of hold.

**Why.** Smash distinguishes these by how far and how fast the stick moved, and a keyboard
has neither. The useful discovery is that the real game's check is *already* a frame-window
test — it asks whether the stick crossed a threshold within the last 3–5 frames — which is
why the all-digital Smash Box controller is tournament-legal. A key press is the only "the
stick just moved" signal a keyboard can produce, so the edge becomes the trigger and the
window carries the rest.

**Rejected.** A dedicated "strong attack" key, as Rivals of Aether uses. It is more
reliable, but it changes the control vocabulary away from Smash's, and the brief specified
the button layout.

**Consequence.** Partial DI is genuinely lost — every keyboard DI input is maximum
strength. Nothing recovers that without an analog stick, which is why the Gamepad API path
exists.

---

## D8 — The two control schemes are alternatives, not two players

**Decision.** Config 1 and Config 2 ship as presets a player chooses between. Activating
both at once is impossible, enforced by `detectConflicts()`. A third preset on a disjoint
key cluster exists for two people on one laptop.

**Why.** They are mirror images, so **six physical keys carry opposite meanings**: `W` is
Config 1's jump and Config 2's up; `←` is Config 1's left and Config 2's special; and so on
for `A`, `D`, `↑`, `→`. A `keydown` event carries no information about whose finger caused
it, so with both active, one player pressing jump also fires the other's up input, for
two-thirds of both schemes. This is arithmetic, not a bug that could be fixed with better
code.

The brief asked for a second config that is "the same but flipped", which is exactly what a
mirrored preset for one player is — a left-handed layout and a right-handed one. Reading it
as two simultaneous players is the reading that cannot work.

**Consequence.** Two-players-on-one-keyboard uses Config 1 plus Config 3. The rebinding UI
refuses any key another active player already holds, so this cannot be walked into by
accident.

---

## D9 — Rollback, over WebRTC, with no LAN special case

**Decision.** GGPO-style rollback with 2 frames of input delay and an 8-frame prediction
cap, over an unreliable unordered `RTCDataChannel`, signalled by Trystero.

**Why.** The brief asked for multiplayer that feels genuinely real-time and specifically
mentioned shared WiFi. Delay-based netcode — which is what Smash Ultimate itself uses —
charges every player the full round trip forever. Rollback shows your own input
immediately and hides the opponent's latency behind prediction. On this one axis the
project is deliberately better than the game it replicates.

**The LAN part solves itself, and that is the finding.** ICE gathers host candidates for
every local interface, and when two peers share a subnet, connectivity checks succeed on
those alone — no STUN, no TURN, no relay, no server in the path. So no code special-cases a
local network: one signalling path is used for every match and ICE's own candidate
prioritisation discovers the LAN route. Two laptops on the same WiFi get a sub-10ms direct
path without a line of code that knows what a LAN is.

**Rejected.** *A relayed WebSocket* — TCP, so one lost packet stalls everything behind it,
which is precisely the spike rollback exists to hide. *Vercel's native WebSockets* — in
beta, pinned to one instance. *A hosted realtime service* — works, but adds an account and
a relay hop for what is a few-second handshake.

**Consequence.** No TURN server ships, so some NAT combinations on the open internet will
fail to connect. That is a real gap, listed in the README, and it does not affect the LAN
case the brief actually asked about.

---

## D10 — Packet loss is handled by redundancy, not retransmission

**Decision.** Every input packet carries a window of the **last 10 frames** of input keyed
by absolute frame number, over a channel configured `maxRetransmits: 0`.

**Why.** A retransmitted input for frame N is worthless once the game is already predicting
frame N+5 — it arrives too late to be anything but history. Sending a redundant window
instead means a dropped packet heals itself 16ms later when the next one arrives carrying
the same frames again. Prediction is only needed if ten consecutive packets are lost.

**Consequence.** Packets are larger than the minimum, and irrelevant: ten frames of a
bitfield is tens of bytes, against a 1200-byte fragmentation ceiling.

---

## D11 — Canvas 2D, with no rendering library

**Decision.** The renderer is hand-written Canvas 2D. No PixiJS, no Three.js, no WebGL.

**Why.** Four fighters, some particles and a parallax background sit comfortably inside
Canvas 2D's budget of roughly 1,000–3,000 draws per frame, and `meleelight` demonstrates
full-roster Melee physics rendering on Canvas 2D alone. Every sibling project in this
repository ships a dependency-free canvas renderer, so it is also the house pattern.
Reaching for WebGL here would spend a real complexity budget solving a problem the profiler
has not reported.

**Consequence.** If particle counts ever grow past what Canvas 2D can batch, this is the
decision to revisit first. The renderer is behind a single `render()` entry point partly to
keep that swap cheap.

---

## D12 — State snapshots are hand-written clones, not typed arrays

**Decision.** `GameState` is plain objects, and `cloneState()` is an explicit field-by-field
copy.

**Why.** Rollback engines classically flatten state into contiguous typed arrays so
snapshotting is a `memcpy`. That is genuinely faster, but writing a fighter state machine
against integer offsets is miserable and error-prone — and this codebase had six agents
building against the same state shape concurrently, where readability had real value.
Four fighters of roughly forty numeric fields is a few hundred field copies, which is
trivially inside budget for the ten snapshots a rollback window needs.

**Rejected.** *`structuredClone`* — a general recursive algorithm, not a memcpy, and
allocation-heavy at 60Hz. *Immutable structural sharing* — makes snapshots free and writes
expensive, which is backwards for a hot simulation loop.

**Consequence.** A test benchmarks the clone and fails if it regresses past budget, because
the argument above is only true while it stays true.

---

## D13 — Desync detection ships from day one

**Decision.** Peers exchange a state hash every 30 frames and report a mismatch loudly.

**Why.** Determinism bugs are silent. They do not throw; they produce a slightly different
number, which becomes a slightly different position, which becomes two players watching
different matches and disagreeing about who won. Every prior implementation surveyed
independently arrived at the same conclusion — GGPO ships a SyncTest mode that forces a
rollback every single frame and diffs the result, and a browser rollback library built
periodic hash comparison in as a first-class feature for exactly this reason.

**Consequence.** `hashState()` must cover every simulation-relevant field in a stable
order. A field added to `GameState` and forgotten in the hash is a hole in the detector, so
the hash test enumerates the state shape rather than spot-checking it.

---

## D14 — Stage forms are a data transform

**Decision.** Ω form and Battlefield form are computed from any stage, not authored per
stage.

**Why.** Sakurai has stated that all Battlefield forms are geometrically identical,
differing only in skin and music, and Ω forms all share Final Destination's geometry. So
the game needs three canonical geometries plus a few unique layouts, with any number of
skins on top. Writing eighteen hand-authored variants would have been eighteen chances to
get a blast zone wrong.

---

## D15 — Desktop only, and the app says so

**Decision.** No mobile layout, no touch controls, and no mobile Playwright project. A
touch device gets an explicit message.

**Why.** Every control in the spec is a physical key. A responsive pass would be testing a
configuration nobody can actually play, and a phone-shaped build that loads and then cannot
be played is worse than one that explains itself.

**Consequence.** This is the one place this project diverges from its siblings, which all
run a mobile e2e project. Stated in the Playwright config so it reads as a decision rather
than an omission.

---

## D16 — Damage is stored unscaled, and 1.2× is applied at runtime

**Decision.** Move data carries base (multiplayer) damage. The 1v1 multiplier is applied by
the engine when a match has exactly two fighters.

**Why.** This is a real sourcing trap: Ultimate Frame Data publishes base damage, Kurogane
Hammer publishes 1v1-scaled damage, and almost every discrepancy between the two sources is
this multiplier and nothing else. Storing scaled values would have double-counted it in 1v1
and under-counted it in a four-player free-for-all. It is also how the real game works — the
multiplier applies to damage *taken*, as a property of the match rather than of the move.

---

## D17 — Move data comes from the decompiled scripts, not from a frame-data site

**Decision.** Angles, base knockback, knockback growth and hitbox coordinates are parsed
out of the game's own decompiled ACMD scripts at patch 13.0.1
(`rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json`), by a script
rather than by reading a table. Only limb-mounted hitbox positions carry
`// POSITION: estimated`.

**Why — this nearly shipped a roster of quietly wrong numbers.** The obvious source is
Ultimate Frame Data, and the brief said to use it. But **UFD publishes no angle, no base
knockback and no knockback growth at all.** Its columns are startup / FAF / landing lag /
damage / *shield lag* / *shield stun* / shield advantage. Read that page expecting BKB and
KBG and you will find two plausible small integers sitting exactly where you expect them —
and they are the shield numbers. The first fetch of Mario's forward smash came back "BKB
11, KBG 12"; the real values are 25 and 99. Every research lane hit the same trap
independently.

Numbers that wrong would not have crashed anything. They would have produced a game where
every move launched at the wrong angle for the wrong distance, and the only symptom would
have been that it did not feel like Smash.

**Consequence.** This also corrected the assumption in this project's own research notes
that hitbox coordinates are unpublished. The decompiled dump *does* carry them, as X/Y/Z
per bone with the root bone's forward axis on Z — so root-bone hitboxes are exact, and only
the animation-dependent limb-mounted ones are estimated.

**Corrections this sourcing forced, each now pinned by a test:** Fox's up smash is frame 8,
not frame 2 (frame 2 is UFD's *charge hold* note on the same row; his frame-2 move is the
jab). Fox's Reflector is frame 3, not frame 1 — that is a Melee property. Marth's dair
tipper does not spike; the meteor is a separate hitbox, frame 11 only. Kirby does not have
the worst air speed — he is floaty, which is a different stat.

---

## D18 — CPU reaction time is a stale view, not a handicap

**Decision.** A CPU's level determines how many frames out of date the game state it reacts
to is, rather than applying an accuracy penalty to a perfect read.

**Why.** A CPU that sees everything and then deliberately misses feels like it is cheating
and then apologising. A CPU that genuinely notices late plays like a slow human — it walks
into attacks it would have blocked, and it gets punished for committing. Ultimate's own
documented behaviour supports this reading: even level 9 shields **reactively**, triggered
when an attack input actually occurs nearby, never predictively.

**Consequence.** The CPU is a pure function threading the RNG seed, so CPU matches roll
back identically to human ones. It also means a level-9 CPU is beatable the way the real
one is — by baiting the reaction rather than by out-speeding it.

---

## D19 — The engine layering rule is enforced by a test

**Decision.** `src/engine/layering.test.ts` walks the import graph and fails the build if
anything under `engine/` imports React, Next, the renderer, the netcode or the UI, or calls
a banned `Math` function or `Date.now`.

**Why.** Inherited from the sibling projects, where it already earns its keep as a tidiness
guard. Here it does more than that: it is the mechanism that keeps rollback possible. The
rule is not "engine code should be pure" as a matter of taste — it is that a single
`Math.random` in a physics path silently breaks every online match, in a way no unit test
would catch and no player could diagnose.

---

## D20 — Trystero, behind a port

**Decision.** One dependency for signalling, wrapped in a `Transport` interface with three
adapters.

**Why.** Signalling needs two peers to exchange SDP before ICE can start, and Vercel's
serverless functions cannot hold a socket. Trystero does peer discovery over existing
public infrastructure with **no signalling server at all**, so the whole game deploys as a
static site with zero backend and zero accounts. At 42KB it is a small thing to owe.

Behind a port because it is the one component whose viability depends on infrastructure
nobody here controls. If the public trackers become unreliable, the replacement is one
adapter, not a rewrite — and the `BroadcastChannel` and loopback adapters already prove the
seam works.

---

*Entries below this line were added during review, in the order the problems were found.*

---

## D21 — The hit flash cannot be done with a compositing mode

**Decision.** The white flash on a hit victim is a **second flat pass over the fighter's own
shapes**, in the tint colour at the tint's alpha. No `globalCompositeOperation` is set
anywhere in the renderer.

**Why — this shipped, and 178 render tests were green while it did.** The original code did
the obvious thing:

```ts
ctx.globalCompositeOperation = "source-atop";
ctx.fillRect(head.x - 400, head.y - 400, 800, 800);
```

The intent is right and the technique cannot work. **`source-atop` composites against the
entire canvas, not against "the shapes drawn since `save()`".** Canvas 2D has no layers:
`save()`/`restore()` saves *state*, never *pixels*. So every hit bleached an 800×800 region
of the sky, the mountains, the platforms and the other fighter — a hard-edged translucent
rectangle across a third of the screen.

It survived the whole build because the test suite asserted that `source-atop` *was set*,
which enshrined the bug as the specification. It was found by instrumenting
`CanvasRenderingContext2D.prototype.fillRect` in a live browser and looking at what came
out.

**The lesson, kept:** a canvas renderer's unit tests can only tell you the right calls were
made. They cannot tell you the result looks right, and a test written from the
implementation will happily certify the implementation's bug. The replacement tests assert a
*property* instead — nothing paints larger than the fighter's own bounds, and no
non-default composite mode is ever assigned — and both were mutation-checked against the old
code.

---

## D22 — DI resolves on the last frame of hitlag

**Decision.** A hit parks its knockback on the victim (`pendingKnockback`, `pendingAngle`,
`pendingFacing`) and the launch vector is computed when hitlag reaches zero, reading the
direction held *at that moment*.

**Why.** It was originally sampled on the contact frame, with the reasoning that
`FighterState` had nowhere to park a pending launch. That was true and it was a three-field
problem, not a design one — and what it cost was the entire mechanic. Hitlag *exists* to
give the victim a window in which to choose a direction; sampling at contact turns DI from a
reaction into a prediction, which is a different and much worse game.

Measured on a 45° hit: a victim holding nothing at contact and then pressing up during
hitlag now launches at 49.81° instead of 45.00°, and a victim who holds up only at contact
and releases gets no DI at all. Both are correct.

**Consequence.** A grab or a KO has to clear the parked launch, and a hit with zero hitlag
resolves immediately — which is the same rule at length zero rather than a special case.

---

## D23 — Short-hop aerials cost 15% damage, and the input that earns it

**Decision.** `FighterState.shortHop` records how the current airtime began; aerials deal
0.85× damage while it is true. An attack pressed **inside jumpsquat** forces a short hop
regardless of the jump key.

**Why.** The damage reduction is a real Ultimate mechanic and was in the spec, but it is only
half a mechanic on its own. It exists because the universal 3-frame jumpsquat made reflex
short-hopping hard, so the game lets you buffer jump-plus-attack for a *guaranteed* short
hop — and the 0.85× is what you pay for the guarantee. Implementing the penalty without the
buffered input would have been a tax with nothing bought.

The reduction is applied to base damage *before* the knockback formula, so knockback falls
as a consequence rather than being separately scaled. Measured on the same nair against the
same victim: 10.500 → 8.926 damage, and knockback 152.906 → 139.837 at 100%.

---

## D24 — A one-frame tap away from your facing slid a quarter of the stage

**Decision.** A direction reversal from standing or walking takes the same walk-then-dash
path as any other press. Reversals out of `run` still cost a turnaround, and reversals out
of `dashStart` are still instant, so dash-dancing is unchanged.

**Why.** Pressing *away* from the direction you were facing skipped the walk window entirely
and committed to `dashStart` on frame 1. A single-frame tap therefore bought the full
initial-dash burst and slid **19.33 units — a quarter of Battlefield** — while the same tap
in the direction you already faced moved 0.31 units. There was no way to make a small
movement away from where you stood facing.

**Consequence.** Taps are now symmetric: 0.31 units either way. This was found by measuring
tap distances through `step()` rather than by playing, which is the only way a 60Hz
asymmetry that size stays invisible to the eye but obvious to a number.

## D25 — Rollback could not see a button press, and every test passed anyway

**Decision.** `RollbackDeps.step` takes `prevInputs` as a **required** third parameter, and
the session derives it from its own rollback-aware input history rather than from a field
kept alongside it.

**Why — this was the worst bug in the project, and only an independent reviewer found it.**
`step()` needs the previous frame's inputs to tell a *press* from a *hold*: `pressed()` is
`(input & b) && !(prev & b)`. It defaults `prevInputs` to `inputs` when the caller omits
them — which makes `pressed()` **always false**.

The netcode's dependency contract was typed `step(state, inputs)`. Two arguments. So in any
online match, no attack, jump, shield, special or grab would ever have fired. Fighters could
walk and do nothing else.

**It happened in the seam between two slices.** The netcode contract was frozen before the
engine discovered it needed `prevInputs`; each side was internally correct and neither could
see the other. Local play was unaffected because the game loop passed them, which is exactly
why 1,274 tests, a clean typecheck and a working local match all reported health. **The one
thing nobody owned was the join between two things that were each fine.**

**Consequence.** `prevInputs` is required rather than optional, so the type system now
refuses the call that caused this. Mutation-checked: passing `inputs` in its place turns
eight rollback tests red.

---

## D26 — A rounding error at a floor is a whole frame, so the constants are exact fractions

**Decision.** `Ratio` — an exact integer numerator/denominator pair — replaces `fx()` for
**every constant that feeds a `floor`**: the knockback 1.4, hitstun 0.4, hitlag 0.65,
shieldstun 0.8 / 0.725 / 0.33 / 0.29, the electric, shielding and crouch-cancel multipliers,
and the hitstun overflow 0.25.

**Why.** Q12 fixed-point cannot hold any of those values exactly, and three separate bugs of
identical shape had already been found one at a time. `fx(0.4)` is 0.39990 — fractionally
*under*, so `floor(100 × 0.4) − 1` returned 38 instead of 39. `fx(0.65)` is 0.64990, also
under, dropping a frame of hitlag at every exact boundary. `fx(0.8)` is 0.80005 —
fractionally *over*, gaining a frame of shieldstun.

Away from a `floor` these errors are invisible: a knockback value off by one part in ten
thousand is not a bug. At a floor, the same error is a **whole frame**, and a frame is the
unit this entire game is built out of.

**Consequence.** After the third instance, fixing the individual case stopped being the
right move — the class needed a type that made the error unrepresentable. The comment block
at the top of `constants.ts` records which values are ratios and why, so the next constant
someone adds lands in the right category.

**And it was still not enough — see D27.** Making each constant exact fixed the constants
and not the arithmetic between them.

---

## D27 — Exact constants are not exact maths, and the two formulas are different shapes

**Decision.** `byRatios` combines every multiplier into a single numerator and denominator
and truncates **once**. `computeShieldstun` uses it for all of its multipliers.
`computeHitlag` does not share it: it carries an exact numerator/denominator through to its
**first** floor, then floors **again** after crouch cancel.

**Why.** D26 replaced inexact constants with exact ratios and declared the class closed. A
second review round showed it was not: `byRatio` truncates on every call, so chaining two of
them still crosses a boundary even though each constant is now perfect.

The reachable case is Marth's down smash body hit at 8%, charged 22 frames, twice stale —
a damage of 8.6208, or `35311` in Q12. Applying 0.8 and then 0.725 with a truncation between
them yields **6 frames of shieldstun**; combining them first yields **7**. One frame is the
difference between a move being punishable on shield and being safe.

**The more interesting half is that the two formulas are not the same shape**, and sharing a
helper between them would have been wrong. Shieldstun is
`floor(0.8·d·t·m·p + 2)` — a single floor, so everything inside it must be combined.
Hitlag is `floor(floor((d·0.65 + 6)·h·e·s)·c)` — **two** floors, because the real game scales
an already-rounded frame count by crouch cancel. Making hitlag "more exact" by collapsing it
to one floor would have been a faithful-looking change that quietly disagreed with the game.

**Consequence.** "Use exact constants" was the wrong lesson to draw the first time. The
right one is narrower: *identify where the floors are, and make everything between two
floors exact.* Precision anywhere else is neither here nor there.

---

## D28 — An intangible fighter does not spend the swing

**Decision.** A hitbox that overlaps an intangible fighter is skipped entirely and **not**
marked as having hit them, so it can connect later in the same move if their intangibility
ends first.

**Why.** The original code recorded the hit, with the reasoning that "the swing is spent on
them". That is wrong in a way that only shows up on a specific pair of frame windows: spot
dodge is intangible on frames 3–20, and a great many moves stay active past frame 20. A
fighter who dodged the *first* active frame of a lingering move was therefore immune to
every remaining frame of it, which makes dodging strictly stronger than it is in the real
game.

`invincible` is deliberately different and stays recorded: an invincible fighter *is* there,
the hit connects, and only the consequences are cancelled — so the attacker still freezes,
and the attacker's freeze is now computed from the same staleness-, short-hop- and
1v1-adjusted damage an ordinary hit would use. Hitlag is a property of the swing, not of who
it met.

**The test for this was vacuous on the first attempt**, and a mutation check is the only
reason that was noticed: it set one frame of intangibility against a hitbox that does not go
live until frame 4, so intangibility had already expired before the code under test could
run. It passed with the bug reintroduced. The fixture now uses four frames, which genuinely
covers the hitbox's first active frame and not its last — and fails when the fix is reverted.

---

## D29 — Four bugs in one place, because the seam was the only module with no tests

`src/game/matchRunner.ts` is the whole of the join between a pure simulation and a browser.
It shipped with no test file, and every module it drives shipped with a thorough one — which
is exactly backwards, and produced four separate defects that a player meets in the first
thirty seconds and that not one of 1,289 passing tests could see:

| Symptom | Cause |
|---|---|
| No key did anything, all match | `play/page.tsx` built the keyboard reader and never called `attach()`, so it bound no listeners and `drain()` truthfully reported "nothing held" forever |
| A white wash over the screen from the first KO onward | The runner called `ingestEvents` instead of `stepVfx`, so `updateVfx` never ran and `koFlash` never decayed from 12 |
| Hit sparks that stayed on screen for the rest of the match | The same line: particles were created every frame and aged on none |
| No sound at all, anywhere | Nothing outside `src/audio/` imported `src/audio/` |

The common shape is not carelessness about any one of them. It is that **a collaborator with
a per-frame contract has no way to complain about not being called.** `updateVfx` is correct.
`AudioEngine.handleEvents` is correct, and its doc comment even says "call it every rendered
frame" — written for a caller that did not exist. Each was unit-tested in isolation and each
passed, because a module that is never invoked is indistinguishable from one that works.

Nothing above the seam caught it either. `flow.spec.ts` asserted the frame counter was
advancing, which is true of a match nobody can control. `controls.spec.ts` was green because
it tests the screen that *documents* the controls. The one assertion that would have caught
the dead keyboard — press a key, check the fighter moved — was the assertion nobody had
written.

**So the tests added here assert the drive, not the arithmetic.** `matchRunner.test.ts` counts
the calls the loop is contractually required to make (vfx aged exactly once per simulation
frame; audio driven every frame; the KO flash actually reaching zero), and `e2e/gameplay.spec.ts`
presses real keys at a real match and asserts the *fighter* changed. Both were confirmed by
reverting each fix and watching them go red.

One of those e2e assertions was vacuous on the first attempt, in the same way D28's was: it
checked `fighters.some(f => f.damage > 0)`, which a player who cannot move satisfies within
seconds by being beaten up. It now asserts the *opponent's* percent rose, which is only
possible if the player's inputs arrive.

---

## D30 — A CPU's swing range has to come from its own arms

`attack` swung whenever the opponent was within `MELEE_RANGE`, a single constant of 20 units
shared by the whole roster, and `approach` stopped closing at the same constant. Donkey
Kong's jab reaches 11.5 units — offset 7.5 plus radius 4.0. So a CPU could stand 14 units
away, be inside its own attack threshold and outside its own reach, and punch air.

What made that fatal rather than merely bad is that **nothing perturbs it**. `approach`
declines because the target is close enough; `attack` accepts and whiffs; neither fighter
moves; the next frame's state is identical, so the same decision returns. A real match
observed live sat at 58%–0% for thirty seconds with the CPU jabbing at nothing, and would
have sat there until the timer ran out.

The fix is to stop guessing. `meleeReachFromDef` reads the reach out of the fighter's own
move data, and the runner hands it to each CPU alongside the stage geometry and air-jump
count it already supplies. Two details are deliberate:

- It takes the **minimum** across jab and forward tilt, not the maximum. The default swing
  does not choose which one comes out — the engine reads a tilt when the direction has gone
  stale and a jab when it has not (SPEC §6) — so closing to the shorter of the two is the
  only distance at which *whichever* the engine picks connects. Every heavier option reaches
  further than either.
- It **ignores the victim's hurtbox radius**, which only ever adds reach. Standing slightly
  too close costs the CPU nothing; standing slightly too far cost it the entire match.

The regression test sweeps every distance from 1 to 40 units against six different reaches
and asserts that at least one of `attack`/`approach` acts at each. Swept rather than
spot-checked because the bug lived in a *band*: any single sample outside 11.5–20 passed.

An earlier attempt tested this by running a CPU against a motionless opponent for twenty
simulated seconds and asserting it dealt damage. That test was thrown away — it failed for
three fighters for reasons that had nothing to do with the bug. A fighter with no input never
leaves the respawn platform, so the "statue" was standing 24 units in the air and the CPU was
correctly jumping at it; and one failure was simply the assertion reading the victim's
percent on the frame *after* a KO reset it to zero. A test whose failures need that much
explaining is measuring the wrong thing.

---
