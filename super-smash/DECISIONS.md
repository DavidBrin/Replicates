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

## D31 — Up jumps, and still aims, and the arbitration is five frames long

On a Switch the left stick does both jobs: push it up and you jump, tilt it up and press A
and you get an up-smash. One control, two meanings, told apart by *magnitude*.

A key has no magnitude. So the only signal left is **time**: an up press that is followed by
attack, special or grab was an aimed attack, and one that stands alone was a jump. Which
means the jump has to wait long enough to find out.

`TAP_JUMP_FRAMES` is deliberately equal to `SMASH_INPUT_WINDOW`, and not chosen for feel.
Five frames is exactly how long an up press stays eligible to become an up-smash, so a
shorter wait would fire the jump first and make up-smash unreachable from the arrow cluster,
while a longer one would delay every jump for nothing further in return.

Five frames is 83ms and it is felt. That is what the dedicated jump key is for: it has no
ambiguity to resolve, so it fires on the frame it is pressed, and a player who wants the
snappier jump has one. This is the same trade the real game offers as the "tap jump" setting,
arrived at from the other direction.

The implementation needs no new state, which is worth stating because the obvious version
does. Tap jump fires when `lastDirPressed` is up and `framesSinceDirPress` equals the window
— both fields the smash/tilt rule already maintains — and it is expressed as an ordinary
`jumpPressed`, so the buffer, jumpsquat, short hop, air jumps and ledge jumps all treat it
identically without knowing it exists. Two properties fall out for free:

- **An attack inside the window suppresses it automatically.** Pressing attack takes the
  fighter out of an actionable state, so by the frame the jump would fire it is never asked
  for. There is no "was it claimed?" flag to keep.
- **Holding up cannot pogo.** `framesSinceDirPress` is reset by *any* fresh direction, so it
  can only equal the window once per press.

---

## D32 — Two engine features the roster used and nothing read

`MoveDef.momentum` and `MoveDef.superArmourFrames` were both in the type from the first
commit, both referenced by fighter data, and both read by no code at all.

The armour one was cosmetic: Donkey Kong's Giant Punch declared `superArmourFrames: [9, 20]`
and flinched like anybody else's jab. The momentum one was not. **No fighter could recover.**
Up-special played its animation and left the fighter exactly where it was, so every hit that
sent a player off the stage was a stock, for all eight fighters, from the first match.

This is the third bug of this exact shape in the project (see D29) and the pattern is now
unmistakable: *data that describes behaviour, and no test that the behaviour happens*. Every
adjacent test passed. The frame data was well-formed and `schema.test.ts` proved it.
`specialSlot` returned `"upB"` for an up input and `states.test.ts` proved it. The state
machine entered `special` and played the clip. What nobody had written down is the property a
player notices in ten seconds — that pressing up-special off the side of the stage gets you
back.

So `fighters/specials.test.ts` drives the real `step()` loop with the real roster and asserts
on **where the fighter ends up**, for every fighter, with the bar set at a fighter's own
height. Nothing in it inspects `momentum`: a test that read the same table the code reads
would pass just as happily against an engine that ignored it, which is exactly what shipped.

Two design notes on `momentum` itself:

- It **sets** velocity rather than adding it. These are scripted movements with a definite
  speed; adding would make a Fox Illusion out of a run travel further than one from a
  standstill.
- It needs `hold`, or a downward impulse is clawed back to the fighter's ordinary fall speed
  on the very next frame by gravity — which is the difference between a stone and a puffball.
  While a hold is live, gravity does not apply.

Writing it turned up an immediate consequence: returning early to skip gravity also skips the
clamp that stops a grounded fighter driving into the floor, and a grounded Stone fell out of
the world. A grounded Stone now sits there, which is also what it does in the real game.

---

## D33 — A rebinding UI the match never read

`/controls` shipped with per-player scheme assignment, per-action rebinding, a live keyboard
diagram and conflict refusal. All of it worked. None of it reached the game: `schemeForMenuId`
returned the hard-coded preset and never saw the store, so a player could rebind every key,
watch the diagram redraw, start a match, and find the original keys driving their fighter.

The same shape as D29's dead keyboard and D32's dead frame data, and caught the same way —
by a test that presses the *new* key and looks at the fighter. `e2e/rebinding.spec.ts` does
the whole thing in one page session, because the match configuration is a client-side store
and a `page.goto` between the rebinding and the match would reset it and pass against a game
that had silently reverted to the defaults.

Its first draft asserted the old key no longer moved the fighter by measuring displacement,
and failed against a correct build: a fighter still decelerating out of the previous hold, or
shoved by the CPU, drifts several units with no input at all. It now samples *action states*
— did a walk ever start — which has one cause.

---

## D34 — An attack's animation is timed against its own hitbox, not its own length

Play testing said the attacks "don't look like anything", and they didn't. The cause was one
line: an attack clip ran at `actionFrame / totalFrames`, which puts the strike key at a fixed
*fraction* of the move. No hitbox is live at a fixed fraction of its own move. Mario's forward
smash connects at 32% of its 47 frames; his jab connects at 10% of its 20. So the jab reached
full extension eight frames after its hitbox had already gone, and the forward smash arrived
at its extension a frame late and then held one pose, motionless, for thirty frames.

A clip now declares which of its keys is the moment of contact, and `poseTimeFor` stretches
the wind-up and the recovery independently so that key lands on the frame the move actually
hits. One shared clip therefore serves a 20-frame jab and a 47-frame smash and reads correctly
in both — which is the whole premise of the shared pose library (D2), finally holding.

Three smaller things followed from looking closely:

- **Wind-ups accelerate into contact; recoveries decelerate out of it.** A smoothstepped
  wind-up decelerates *into* the hit, so a forward smash arrived at full extension at walking
  pace, and the whole game read as being made of putty.
- **Every attack gained a follow-through key.** A single ease from the extension to the rest
  pose across thirty recovery frames is well under a degree a frame, and reads as a freeze.
- **Frame numbers are quoted from one and `actionFrame` counts from zero.** That was known in
  the collision loop and rediscovered by hand in two more places, so it is now `moveFrameOf`
  and `actionFrameOf` in `hitbox.ts` with the reasoning attached.

---

## D35 — The swing is drawn from the move's hitboxes, never authored

A fighter's limbs are a few pixels thick and a swing lasts three frames. Every fighting game
since the arcade era solves this the same way: the *weapon trail* does the reading, not the
limb. `render/swing.ts` is that trail, and it says three things a pose cannot — which
direction the attack points, how far it reaches, and on exactly which frames it can hurt you.

**Nothing about it is authored.** The pivot is the fighter's shoulder, the radius is the
distance to the furthest live hitbox and the sweep is centred on that hitbox's direction, so
the graphic is derived from the same numbers the simulation hits with. An authored arc would
be a second source of truth about where a move reaches, and the two would disagree within a
week. `swing.test.ts` walks every attack of every fighter on every frame and asserts the arc
never reaches past the hitbox it came from, because a swing drawn longer than its own hitbox
teaches a distance that will whiff and the player will blame the hit detection.

It is drawn per *hitbox window* rather than per move, so a multi-hit is several swings — one
arc spanning Link's whole spin attack would claim the blade was out for most of a second.

---

## D36 — A hit spark is punctuation, not the sentence

The burst star reached nine simulation units and swelled to 2.8× before dying: a star four
times the height of the fighter who threw it, on screen for nearly half a second. On the one
frame a player most needs to read — who was hit, and which way they are going — the screen
was a solid orange shape.

It is now about a third of a fighter and gone in a tenth of a second, and both halves are
bounded by a test, because either one alone brings it back. Its sparks also fan along the
launch angle rather than in a symmetric puff, which meant carrying that angle on the hit
event: the direction is resolved from the hitbox and the attacker's facing inside the engine,
where `knockbackToVelocity` already owns that mirroring rule, rather than being re-derived in
the renderer where the two would be free to disagree.

Knockback itself was invisible — a fighter flew off in silence at the same apparent speed
whether the hit was a jab or a kill move — so a launched fighter now drags a port-coloured
streak emitted from their own velocity. It reuses the existing spark particle, which already
draws itself stretched backwards along its motion; nothing new to draw.

The freeze needed the same treatment from the other side. Hitlag on a strong hit is nineteen
frames, and it is correct that it is — the formula matches the published one — but the spark
is gone after nine of them and the squash is static, so the back half of every heavy hit was
a still image. `hitlagShake` alternates both fighters a fraction of a unit either way off the
hitlag counter, decaying as it runs out. It is what turns a third of a second of nothing into
a *held* moment rather than the game appearing to hang.

---

## D37 — Whoever is doing something is drawn on top

Port order is the obvious draw order and it is the wrong one. It means the player on port 1
spends every exchange hidden behind whoever is on port 2, and against a body as wide as
Donkey Kong's, "hidden" is literal: a forward smash landing squarely was invisible, because
the fighter throwing it was entirely behind the fighter taking it.

`drawDepth` sorts by what each fighter is *doing* — attacking in front, being hit behind,
everything else between — and the sort is stable, so two idle fighters do not swap depth
every time one of them twitches.

The camera had the same class of problem from the other direction. It was told to keep 72% of
the main platform in frame, which is wider than two fighters ever get, so the platform and not
the fighters set the zoom for the entire match and the camera never pushed in on anything. A
fighter was an eighth of the screen height and a whole arm swing was a dozen pixels. It now
keeps a third of the platform in shot and pushes to 15 px/unit, which puts a fighter at about
a fifth of the screen — roughly where Ultimate sits in a close 1v1. The stage edges are
allowed to leave the frame during close combat, exactly as they do in the real game.

The vertical framing was wrong for a smaller reason with the same flavour: the bounding box
was drawn round fighters' *origins*, which are at their feet, so the box the camera framed
sat entirely below the fighters in it. Together with the ground kept in shot underneath, that
put the platform across the middle of the screen and gave the whole lower half of every frame
to the stage's underside while the fighters crowded the top. The box now includes a fighter's
height, which is one constant — `FIGHTER_UNITS`, shared with the effect sizing, so "a
fighter" means one thing in the renderer rather than two.

---

## D38 — A special needs a prop, not a better pose

There are four special clips — `neutralB`, `sideB`, `upB`, `downB` — and thirty-two specials.
So Kirby's Stone and Samus's Charge Shot were the *same animation*: a fighter crouching
slightly. The move list was right, the frame data was right, the mechanics were right, and
every special in the game looked like every other one.

The shared pose library is the correct decision for ordinary attacks, because a rig's
proportions carry the identity (D2) — Donkey Kong's forward smash is Mario's on much longer
arms and reads as his. It does not work for specials, and the fix is not more clips. What the
eye reads in a special is the **prop**: the stone, the plasma, the hexagon. `render/specialFx.ts`
is one entry per fighter per slot, and an entry may replace the fighter outright. Exactly one
does — Kirby, who *is* the stone.

Anything with no entry draws nothing, which is correct rather than incomplete: a special whose
whole graphic is its projectile, like Link's arrow or Mario's fireball, is already drawn by
`drawProjectiles`, and a glow on top would only muddy it.

The failure mode here is silent — a typo in a table key, or a move renamed in `fighters/`, and
the effect simply stops being drawn with nothing to indicate it — so `specialFx.test.ts`
asserts every key names a move that actually exists.

---

## D39 — Seventeen of the twenty-one movements were a single frozen pose

The attacks were fixed first (D34) and the movements were left, on the assumption that they
were merely rough. They were not rough. Of the twenty-one non-attack clips, **seventeen were
one keyframe** — `still()` — which means a dash, a skid, a jumpsquat, a landing, a roll, a
spot dodge, an air dodge, a shield, a reel and a ledge hang were each a photograph held for
the entire duration of the state. A thirty-one-frame roll was thirty-one identical drawings
of a crouching fighter, and the only reason it read as a roll at all was a whole-body rotation
the renderer applied on top.

This was invisible for a specific reason worth recording: **there was nowhere to look at an
animation.** Checking one meant starting a match, provoking the state and hoping a screenshot
landed on the right frame — and a screenshot round-trip is about 250ms, which is fifteen
simulation frames, wider than most of these animations are. So the fix came in three parts and
only the third is animation.

**A place to look.** `/anim` draws one cell per simulation frame of any action at its true
length, sampled through `samplePoseForFighter` exactly as the match samples it, plus 60Hz
playback and an onion skin. `scripts/animsheet.mjs` captures the strip headlessly. The first
contact sheet it produced — four identical Marios labelled 0, 1, 2, 3 — was the whole
diagnosis in one image.

**A duration.** A clip that was not an attack ran at `actionFrame / 30`, a number with no
relationship to anything. Nobody noticed because a photograph cannot be mistimed. The moment a
landing has a squash key and a recovery key the question is unavoidable: a landing is four
frames, a landing out of an aerial is however many its landing lag says, and a roll is
thirty-one. `actionDurationFor` reads the state machine's own constants, imported rather than
copied, so an animation cannot drift out of step with the state it animates.

**A file per clip.** The library was one 1,700-line object literal, which meant one animation
at a time and nowhere to put the reasoning for a particular clip's beats. Each now lives in
`render/poses/<name>.ts` next to its own frame budget and its own reference to the real game.

Two things moved onto the clip as part of this. `spin` — whole turns of the body across one
play — because keyframe rotation interpolates the short way round, so a key at 0 and a key at
360° are the same key and the body never turns; that is why roll needed a special case in the
renderer, and now it does not. And `period`, the length of a looping cycle, which belongs to
the animation that was drawn at that cadence rather than to a table somewhere else.

The vocabulary grew where one clip was being asked to serve two different motions:
`crouchStart` and `crouchEnd` are descents and rises rather than the settled crouch,
`doubleJump` is not the first jump, `fastFall` is not a fall, `landingLag` is not a light
landing, and `getUp` is not lying on the floor. Each started as an alias of what it used to
share, so the vocabulary could be wired and tested before any of them were drawn.

---

## D40 — A fighter who leaves no mark on the floor is a cursor

The simulation emits an event for a grounded jump and for a landing, and for nothing else,
because those are the two moments the *engine* cares about. Every other time a fighter shoves
against the ground — the burst out of a dash, the four frames of a skid, footfalls in a run,
the scuff at the start of a roll, the extra weight of a landing out of an aerial — is a span
of an action state that nothing announces.

So `trackGroundFx` derives them from state, the same way `trackAfterimages` already derived
dodge trails, and for the same reason: a dodge is a span and not a moment. No engine change,
no new events, nothing that could desync.

The direction is the part that carries the meaning. Dust thrown evenly is a generic puff and
reads the same for every action; dust thrown *backwards* is a fighter accelerating away from
it, and dust thrown *forwards* is a fighter still sliding into it. Dash and skid are the same
cloud with opposite signs, and that sign is the difference between starting and stopping.

The midair jump gets a white ring, which in Ultimate is the clearest read a player has that
an opponent's second jump is spent — and it is deliberately not fired for the first jump,
which already has its own event and would otherwise be drawn twice.

---

## D41 — One agent per movement, and what twenty-one pairs of eyes found

Every movement clip was rewritten by a separate agent working on that one animation: its own
file, its own test, its own research against SmashWiki, and its own obligation to *look* at the
result in `/anim` on three differently-proportioned rigs before reporting. The parallelism was
the point — twenty-one animations is more than one pass of attention can hold, and an animation
nobody looks at is exactly how seventeen frozen poses shipped (D39).

What came back was better animation, and something more useful: **the same defect found
independently by several agents is a defect that is really there.** Three found the right foot
pointing backwards. Three hit the sampling convention. Two asked for a per-clip rotation pivot.
That convergence is what a single reviewer cannot produce, and every one of them turned out to
be a real bug in shared code rather than a misunderstanding of it.

**The right foot rested backwards.** Bone angles accumulate down the chain and the two legs are
not mirrored — the whole rig is, once, at draw time — so `footR: deg(88)` resolved to 268°.
Nearly every clip names the feet and overrode it, which is why it survived; `idle` names no leg
at all, and `idle` is what a fighter does whenever nobody is pressing anything. Fixing the rest
angle then exposed that four clips had *authored* their feet to match the broken value, so they
had one foot on backwards too.

**A fighter rolling left spun backwards.** `resolve` mirrors x, which already reverses a
rotation's visual sense, and the renderer signed the spin by facing on top of that. The two
cancelled. Verified by measuring where the head actually goes rather than by reasoning about
signs, and the property the fix rests on is now a test in `skeleton.test.ts`.

**Feet sank into the stage, and the reason is worth keeping.** Depth bought with `offsetY` has
to be repaid by folding the legs, and the fold repays *in proportion to leg length* — so a
crouch planted on Mario buries Kirby, whose legs are half as long. `scaleY` squashes about the
feet and costs nothing in ground contact, which is why it is the right way to get low.
`poses.test.ts` asserts both the absolute plant and the cross-rig spread; the second is the one
that names the cause.

**`t = 1` is never sampled.** `poseTimeFor` divides `actionFrame` by the state's length and
`actionFrame` runs 0..n-1. Three agents hit this while authoring and worked around it
independently; a fourth put its three keys exactly on the sampled grid on purpose. The first
instinct was to change the mapping — and that would have broken work that is now correct and
documented. The convention is written down in `clip.ts` instead, and the property they were
each satisfying is a test.

**And the tool lied.** The lab's fighter dropdown was built from the rig table's keys while its
speed lookup wanted a fighter id, which Donkey Kong spells differently. His walk and run — the
two clips paced by ground covered — got a speed of zero and stood perfectly still, under a
heading reporting the wrong cycle length. Several agents reviewed his locomotion against a
motionless drawing and called it verified. A review tool that fails silently is worse than no
review tool, because it converts "unchecked" into "checked".

---

## D42 — Fade between clips, but not into a hit

Every clip is authored on its own, so nothing joined them up: on the frame a fighter stopped
running the legs were mid-stride, and on the next they were wherever the skid's first key
happened to put them. A cut, not a deceleration, at every one of the forty-odd transitions a
match is made of. `blendSamples` had existed since the pose library did — correct, tested, and
called by nothing, which is the fourth feature found in that state.

Two kinds of change still arrive on the frame they happen. An **attack** is timed against its
own hitbox (D34), so fading into a jab that comes out on frame 2 would put the fighter
three-quarters of the way to a stance the move has already left. And anything **imposed** — a
hit landing, a shield breaking, a grab connecting — is the moment of impact, and impact that
eases in is not impact. Those are the transitions the eye is most attuned to, so a fade there
costs more than it buys everywhere else combined.

Four frames, because the shortest state anything fades into is the four-frame landing and a
fade longer than the state it enters would never finish.

Two consequences worth recording. The fade is what made the backwards-foot bug *visible* — a
176° foot flip that a hard cut had hidden became an interpolated spin — which is a fair
description of how latent bugs surface: something else gets better and they stop being hidden.
And clip time now counts from the frame the **clip** started rather than the action, because
fast-falling swaps one clip for another without restarting anything: a player who pressed down
twenty frames into a descent entered the dive two-thirds of the way through it and never saw
the snap, which is the whole read the opponent is supposed to get.

---

## D43 — What this pass did not fix

Recorded because each of these was diagnosed properly and then deliberately left, and a reader
who finds one should know it was seen rather than missed.

**The two forearm conventions.** `forearmR` positive with `forearmL` negative is not a
geometric mirror — it puts the two elbows on opposite sides of the body, so the right elbow
folds behind the upper arm while the left folds in front. The run cycle now uses the correct
rule (both negative for flexion) and the rest of the library still uses the old one. Fixing it
means changing every clip in one go, because the cross-fade meets the two conventions at every
seam between them, and doing that safely means re-verifying all twenty-one animations. The dash
was brought onto the run's convention at the one seam where the elbow gap was largest.

**A lying fighter's height is not proportional to its own.** `downed` rotates a standing body
about a pivot at 45% of rig height, but the height a flat body rests at is half its *thickness*
— and those two do not scale together. At the best single `offsetY` the roster spreads 4.6
units: Marth floats, Kirby sinks. No combination of the existing channels closes it, because
the required corrections have opposite signs. It wants a per-clip pivot, or a clip that can say
"plant my lowest point on the floor" and have the renderer solve it.

**The foot slip in the walk and the run is in the constant, not the poses.** `STRIDE` is 36
world units per cycle against a leg about 4 units long, so a step is four times a leg and no
arrangement of that leg can cover it. Both agents solved their stance legs from ankle
*positions* rather than angles and give back what a leg can — around a fifth of the step. The
rest is the constant, and lowering it would put Fox at four frames per cycle.

**A hanging fighter is drawn where the engine says they are.** `grabLedge` puts the fighter's
origin *at* the ledge lip and the hurtbox stands on that origin, so the simulation models a
hanging fighter as occupying the space above the ledge. Drawing them where a hanging fighter
actually is — a body-length lower, hands at the corner — would put the visible figure outside
its own hurtbox and make every edgeguard look like a miss. The clip treats the grip as a
notional hold above the fighter's head instead, which is a compromise with the engine and not
an animation choice.

**The shield does not know its own health.** The bubble shrinks as the shield decays and the
fighter inside is mute about it, because the pose layer is never told `shieldHealth`. The clip
is a strain *cycle* — it returns to where it started, which health never does — and that is
stated in the file rather than faked with `actionFrame`, which resets on shieldstun and on
re-entering shield while health carries over.

---

## D44 — A fighter may play their own clip

The pose library is shared by design (D33): fifty clips across eight rigs rather than four
hundred hand-authored ones, with proportion carrying the identity. Donkey Kong's forward smash
is Mario's played on arms half again as long and it reads as Donkey Kong's.

It stops working at the specials, and it stops working badly. Four special clips serve
thirty-two specials, so Samus's Charge Shot and Kirby's Stone were the *same animation* — a
fighter crouching slightly. `specialFx.ts` (D36) patched over that with props: the plasma, the
rock. A prop cannot fix a pose that is wrong. Marth's Shield Breaker is a two-handed overhead
thrust and Pikachu's Thunder Jolt is a cheek-sparking hop, and no amount of glow makes one look
like the other.

It also stops working for the handful of *normals* whose shape is the character rather than the
archetype. Link's forward smash is a sword coming down; Kirby's is a flying kick; Samus's is a
cannon blast. Those are different animations, not one animation with different arms.

So `clipFor(fighterId, name)` asks one further question before handing a clip over: does this
fighter author their own? Name one and they play it; name nothing and nothing changes. The
default stays the default — the override is for the moves that earn it, and a fighter whose
`poses.ts` is empty is a fighter for whom the shared library was already right.

The id travels on the fighter as `defId`, which `FighterState` already carried, rather than as
a fifth optional argument. An argument callers can forget is an argument callers will forget,
and the symptom would be a fighter silently reverting to the shared animation — indistinguishable
from the animation simply not being good enough yet, which is the worst thing to be unable to
tell apart while eight people iterate on exactly that. `chars.test.ts` drives the override
through `samplePoseForFighter`, the function the renderer actually calls, and was verified by
breaking the lookup and watching it go red.

---

## D45 — One directory per character, because eight is eight jobs

Making eight characters look like themselves is eight independent jobs that touch almost nothing
in common. The only thing that made it one job was where the code lived: one rig table, one
effects table, one pose library, all shared.

Now `src/render/chars/<id>/` holds `rig.ts` (proportion, palette, props), `poses.ts` (the clips
that are theirs) and `fx.ts` (what their moves paint, and their projectiles). The shared parts
moved down into kits — `rigKit.ts` and `fxKit.ts` — that a character's file can import without
importing the renderer that consumes it, which is what keeps the graph acyclic.

Three shared tables were also closed doors, and each is now openable from a character's own file:

**Props were a fixed union of thirty shapes** with a shared painter table, so Link's hookshot or
Samus's grapple beam meant editing a file every other fighter lives in. `kind: "custom"` carries
its own painter. The one rule is to paint through the brush rather than setting `ctx.fillStyle`:
the figure is drawn twice, inflated in the outline colour and then in body colours, and a
painter that sets its own fill paints that colour into the rim pass and punches a hole in the
silhouette.

**Projectiles had seven shared shapes** and a `visual` hint chosen by the engine. Mario's
fireball and Fox's blaster bolt were both `"energy"`. A fighter can now paint their own, keyed
by the projectile's def id rather than by the move, because one move can spawn several and a
projectile outlives the move that made it.

**Effects were restricted to `action === "special"`**, which is our distinction and not the
game's — a tipper flash, a sword arc and a sparking knee are all attacks. The restriction bought
nothing: a slot with no entry was already the cheap path. Keyed by move slot now, any slot.

---

## D46 — Photographing a move as it is actually played

`animsheet.mjs` (D39) draws a pose in the lab, which is the right tool for the pose and blind to
everything around it: the swing arc, the projectile, the hit spark, the dust, the opponent
flinching. Those are drawn by the match and only by the match.

A screenshot costs about a quarter of a second, which is fifteen simulation frames, so a running
match cannot be photographed mid-attack at all — a two-frame jab is over before the shutter
opens. `scripts/fightsheet.mjs` drives a real match through the menus, then stops the clock with
`__smashDebug.pause()` and cranks it by hand a frame at a time.

Two things it learned the hard way. It presses keys rather than poking state, because a move
that cannot be reached from the controls is a move nobody will ever see and the capture failing
is the correct outcome. And it waits for the footing the move needs before pressing: a grounded
attack pressed while the fighter happens to be airborne silently performs the *aerial* of the
same direction, and the first sheet it produced came back labelled `fsmash` showing a forward
air — exactly the kind of quiet wrong answer a review tool must never give.

---

## D47 — What eight parallel characters found in the shared code

One agent per fighter, each owning three files and forbidden from touching anything shared. The
constraint was there to stop eight people editing one table at once. Its more valuable effect was
that **every shared-code defect had to be reported rather than worked around**, and a defect
reported independently by two agents is a defect that is really there.

Five landed, each found by someone who could not fix it:

**Both ear painters had every `y` negated.** A prop's local `+y` runs along its bone toward the
tip, so on the head they grew *down into the skull* and what showed was a dark nub on the jaw.
Fox proved it by rendering Pikachu; Pikachu proved it the other way round. Both routed around it
with a `custom` prop. Link never noticed and had shipped with no visible ears at all.

**`hexToRgb` returned black for anything that was not hex.** So `withAlpha` applied twice was
black, and `glow`'s derived mid stop was black whenever its `inner` argument already carried an
alpha — which it does whenever an effect fades over its own lifetime. Under `lighter`
compositing, where black is the identity, that renders as *nothing at all*. Two characters hit it
independently and both worked around it locally.

**`ease: "out"` on a strike key abandons the contact pose in one frame.** It is a cubic, so for a
44-frame smash with its hitbox live 15–19, the fighter is 36% of the way to the recovery pose by
the last active frame. Every attack in the game was being visibly withdrawn while it was still
hitting. The fix is a second key held at the end of the active window, at
`strike + (1 − strike)(last − first)/(total − first)`, and it was applied across the roster.

**`SLOT_POSE` collapsed all four jab slots onto one clip.** Mario's third-hit roundhouse and
Fox's rapid flurry could not exist without putting a kick in the tail of every jab. Two agents
reported it. The three new names alias the first hit's clip, so the default is unchanged.

**`drawMoveFx` bailed unless the action was `special`, `attack` or `throw`.** `startMove` gives a
grab the action `grab`, so a grab's effect was drawn in the animation lab — which drives the pose
directly — and never once in a match. That excluded exactly the two moves whose entire graphic
*is* the effect: Samus's Grapple Beam and Link's hookshot, both invisible tethers.

Three tooling defects were found the same way. The lab capped every attack at 40 frames, because
`actionDurationFor` has no case for `attack` — a move lasts as long as the move — so 51 of Fire
Fox's 91 frames had never been rendered and nobody knew it had no fire. `fightsheet` cropped the
middle of the stage rather than the fighter, so a fighter who spawns near an edge was reviewed
sixty pixels tall. And `chars.test.ts`, which exists to prove the per-character override reaches
the sampler, was **vacuously green**: every assertion loops over the declared overrides and there
were none, so it stayed green through an errant `git checkout` that reverted the wiring entirely.
It now asserts the fixture is non-empty before trusting what it proves.

---

## D48 — `spin` is a screen-plane rotation, and four characters wanted a different one

`poseSpinFor` integrates the clip's `spin` linearly over clip time and seeds it into the root
bone angle, which cartwheels the rig head over heels. Four agents reached for it independently —
for a corkscrew down air, a drill, Screw Attack and Spinning Kong — and all four found the
fighter lying on their side.

It has three defects for anything that is not a genuine somersault. It can only express a
screen-plane turn, and a roundhouse, a corkscrew and Screw Attack all turn about the fighter's
*long* axis, which a rig with one plane cannot rotate about at all. It cannot stop, because it
ramps across the whole clip and carries on through the recovery. And clip time never reaches 1
(D40), so the fighter ends at an arbitrary angle — `spin: 4` measured 2.9 turns on the last drawn
frame, which is what "on her side" actually was.

Two replacements came out of the fan-out, and between them they cover the cases:

**A turn about the long axis** is carried in `scaleX`: wide face-on, collapsed to about a third
edge-on, `linear` throughout, one key per half-turn placed on the multi-hit's own frames, with
the two arms' angles swapped at each half-turn so a limb crosses the body every time. This is how
flat animation has always faked a pirouette.

**A limb turning through more than half a revolution** is stepped 90° per key with *cumulative*
angles — 96, 186, 276, 366, 456 — because `lerpAngle` takes the short way between any pair, so
96 → 456 written as 96 → 96 is the same key and the limb never moves. Link's Spin Attack gets
940° of blade path this way.

`spin` is left as it is and is still right for a tumble or a roll, where the body genuinely does
go over. What it is not is a general rotation.

---

## D49 — Reporting which hitbox won a hit

A move is several hitboxes at once and `bestHitbox` resolves an overlap by lowest id — which *is*
the sweetspot mechanic, not an implementation detail of it. Marth's tipper, a sourspotted aerial,
Bowser's fist: the same swing does one of two very different things, and which one is the single
most important fact about the exchange for the two players watching it.

`StepEvents.hits` carried attacker, victim, damage, position, knockback and angle, but not the id
of the box that won, so the renderer could tell that something connected and not *what*. A tipper
flash could only ever be painted from geometry — where the blade is, rather than whether the
blade is what landed — and the only available signal, `f.hitlag > 0`, is set by any connection, so
landing the handle bloomed exactly like landing the point.

`hitboxId` is presentation-only like the rest of `StepEvents` and stays outside `hashState`, so
determinism and desync detection are untouched. `VfxState` latches it per attacker, scoped to the
current action so a hit from the previous swing cannot bloom this one.

---

## D50 — What this pass did not fix

**Effects paint under the fighter, and some of them want to be above.** An up-air's graphic sits
where the fighter's own port tag is drawn, and the tag is painted over everything — so the centre
of Samus's drill is occluded in a real match, and every fighter's up air has the same problem.
Link's boomerang hit the same wall from the other side and was solved authorially, by winding up
above the head instead of behind the shoulder. A proper fix lets an effect declare that it paints
after the figure.

**A prop cannot move on its own.** Painters get no frame input, so Fox's tail can only move when
a pose moves the hip — it cannot lag, follow through, or settle. That is most of what makes a
tail read as a tail.

**Several rigs cannot reach their own hitboxes.** Fox's up smash boot cannot clear his head
because the leg chain is shorter than the head bone plus the head radius; his up tilt cannot
plant his hands because the arm chain bottoms out at hip height; Pikachu's forward tilt extends a
foot 3.4 units from the spine against a head radius of 2.6. In each case the effect carries the
move and the limb does not, which is a compromise rather than a solution.

**Additive electricity saturates to white over a bright sky.** Clearly yellow against the lab's
dark background and white-hot in a match. Probably correct for the real orb, but it is a property
of `lighter` rather than a choice anyone made.

**Idle is still the shared clip for everyone.** It is the pose a player sees most, and on Samus
it hangs the arm cannon at her side where it reads as a dark slab rather than as a weapon.

---

## D51 — Seven rounds of codex review, and what it kept finding

Seventeen findings across seven rounds, converging on the eighth with none. No P1s at any point,
and after the first round nothing in the game's own logic — which is the useful signal, because
the game code had already been through eight agents and a full test suite, and the *tooling* had
been through neither.

Almost everything it found was in the two capture scripts and the animation lab. That is worth
recording rather than shrugging at, because those are the instruments the whole pass was judged
with, and **an instrument that lies is worse than no instrument**: it does not produce doubt, it
produces confident wrong conclusions. The session had already been bitten by exactly that twice —
a fighter dropdown that resolved a rig and no fighter, so Donkey Kong's locomotion was "verified"
against a motionless drawing; and a capture that photographed a forward air and labelled it a
forward smash.

The findings that mattered most were the ones where the tool was silently substituting something
plausible:

- **The capture accepted any offensive action as the move it was asked for.** A smash input read
  one frame too slow is a tilt, and both are `action: "attack"`. I had fixed this once for
  *footing* — the aerial-instead-of-grounded case — and fixed the symptom rather than the class.
- **The contact sheet capped itself at 48 cells**, so uncapping a move's *length* only meant a
  91-frame Fire Fox got 48 samples spread across it. A sheet that skips frames is worse than a
  short one, because nothing on it says which frames are missing.
- **`--hold` was documented, with a worked example, and never parsed**, so every charge sheet was
  silently the uncharged move.
- **The lab kept the last-picked move when an action had no dropdown**, so a grab drew whatever
  attack had been selected before it.

Three findings were in game code, and all three were the same shape as bugs the agents had already
reported: something scoped one level too narrowly. The effect lookup matched a move slot exactly,
so a grab out of a run — `dashGrab`, which is most grabs — lost its tether. Hitlag freezes
`actionFrame` while the global clock runs on, so deriving an action's start from
`frame − actionFrame` drifted forward and dropped the tipper bloom partway through the crunch,
which is the moment it exists for. And `glow`'s mid stop was a flat 0.35 however faint its centre
had faded to, because `withAlpha` replaces an alpha rather than scaling it — a ring seven times
brighter than the glow it belonged to, outliving it.

One finding was **wrong**: that Link and Samus both declare a projectile called `bomb`. They do
not — Samus has `bomb`, Link has `remoteBomb`, and all nine ids across the roster are distinct.
The fragility underneath it was real, though: `ProjectileState` carries only `defId`, so an id is
the only thing that survives from a definition to the thing in flight, and a collision would be
ambiguous to the engine rather than merely to the renderer. Asserted with a test rather than
restructured, because the assumption belongs to the engine.

Every finding was checked against the code before being acted on, and every fix was
mutation-verified — which is how the wrong one was caught.

---

## D52 — Round two, and what a review of it kept finding

The second art pass ran eight character agents in parallel again, then took the shared code
their reports converged on. The character work is theirs; this records what the round taught.

**Three capabilities were missing, and each was blocking everybody at once.** An effect could
only paint *under* the fighter, so the centre of Samus's drill was occluded by Samus. A prop was
bolted rigidly to its bone, so Fox's tail could only move when a pose moved his hip. The port tag
was placed from `rigHeight`, which measures bones and knows nothing about props, so Pikachu wore
it on his ears. Each was reported independently by two to four agents before it was believed —
convergence is what separates a real defect from one author's taste.

**Parallel agents are a bug-finding instrument, and the bugs they find are in the shared code.**
Round one found the inverted ear painters and `hexToRgb` returning black. Round two found:
`PropAnim.vx` documented as world units and delivered as raw Q12, so a full run reached a painter
as 9839 instead of 2.402; the animation lab never passing `anim` to `drawFigure` at all; and
`resolveCollision` zeroing `vy` on a grounded fighter every frame, which silently disabled
`MoveDef.momentum` for the entire roster — Samus's Screw Attack and Marth's Dolphin Slash both
played their rising animation on the spot. Two agents found that last one from opposite ends of
the roster, and each had first suspected their own capture tooling.

**The lab and the renderer disagreed four times in one pass.** The velocity it never passed, the
rim width it sized by its own formula, the aerials it drew standing on the floor, the second jump
it gave the first jump's velocity. The fix each time was to move the arithmetic into one function
both call, because an authoring view that quietly differs from the thing it authors for is worse
than no authoring view: an author tunes against a fiction and cannot tell.

**The review found twenty-one defects across ten rounds, and fifteen were in the tests.** That
ratio is the finding. The production code had been mutation-tested as it was written; the tests
had not been tested at all, and the pattern was consistent — a test that *named* the property it
was failing to check. `Array.isArray(over)` is true of the empty array that is exactly the data
loss it describes. Strengthened to count canvas calls, it then passed on `save`/`restore`, which
move the count without painting. `overLayer.test.ts` declared a two-caller contract and exercised
one. A tag test overwrote the shipped declaration it existed to protect. Fox's portrait test
compared a call to itself. The rim tests would have passed `return 3 * rigScale`, and every one of
them called the helper directly — so all stayed green against caller drift, which is the thing
that actually caused the bug.

Mutation-testing the implementation is now habit here. Mutation-testing the *test* — breaking the
consumer rather than the function, and checking the test still bites — is the missing half, and it
is where every one of those fifteen would have been caught at authoring time.

**Two findings were declined and one limitation documented.** Modelling aerial trajectories and
scripted momentum inside the lab means a second physics implementation that can disagree with the
real one; `fightsheet.mjs` plays the real move in a real match and is what the character work is
reviewed with. And the Pikachu tag test cannot assert its clearance is *sufficient*, because
`mockContext` returns an identity matrix from `getTransform` and a prop's path ops are in its own
local frame — an attempt at it reported his ears overhanging by 18 rig units on a seven-unit
fighter. The value was set by capture instead, and the test says so rather than implying more
than it checks.

**The review scaffolding lied first.** Run against a base that predated a sibling project's
commits, codex produced fourteen confident, detailed, entirely plausible findings — about a
different application in the same repository, with nothing in its output indicating it had not
reviewed what was asked. The same class of error as a capture tool that photographs the wrong
move, and the same lesson: an instrument that lies does not produce doubt, it produces confident
wrong conclusions.

---

## D53 — The runtime errors, and which of them the app was actually causing

A `chunk.reason.enqueueModel is not a function` crash inside React's flight client prompted a
sweep for runtime errors. The sweep found three real defects. **None of them was that one**, and
saying so is the point of this entry.

**The crash is a development artifact and does not reproduce.** Its stack is entirely inside
Next's vendored RSC deserializer with no application frame in it. `resolveModelChunk` throws that
exact message when a row arrives for a chunk that is no longer pending — legitimate for a
streaming chunk, whose `reason` holds a controller, and impossible for an ordinary one, whose
`reason` is the response object. So it means a row id was resolved twice: a flight payload merged
with another. The dev server that produced it had been up for **nineteen hours**, held alive by a
watchdog written for the eight parallel character agents — a script that only restarts a server
that is *down*, so a healthy but increasingly stale one runs forever. Driving every route and
every client-side transition against it did not reproduce the crash; a clean restart is the fix,
and the watchdog is retired. It is recorded here as unreproduced rather than as fixed.

**The reproducible error was a hydration mismatch on every single page load.** `layout.tsx`
carried `suppressHydrationWarning` on `<html>`, with a comment correctly noting that it suppresses
one level only. Grammarly — the extension the comment was written for — does not touch `<html>`:
it stamps `data-new-gr-c-s-check-loaded` and `data-gr-ext-installed` onto `<body>`, one level
below where the flag reached. The guard was on the one element nothing writes to. Both elements
need it, because both are what a third party can reach before React does.

**A missing favicon was pulling a second copy of React into the build.** There was no `public/`
directory and no icon, so `/favicon.ico` 404'd on every load. A 404 in an App Router app with no
`pages/` directory still falls through to the *Pages Router* error page — which resolves the
installed React rather than the copy Next vendors for the App Router. The build was therefore
emitting chunks for React 19.2.8 alongside Next's vendored 19.3 canary; three sibling apps in this
repository, identical dependencies, emitted one React each. An `icon.svg` and a `not-found.tsx`
remove both the 404 and the fallback, and the second React with them.

**And there was no error boundary at all.** Any throw under the root layout unmounted the tree and
left a blank page — in development behind the overlay, in production behind nothing. A
sixty-frame simulation has a great deal of surface to throw from, and "the screen went white" is
the one bug report carrying no information. `error.tsx` offers `reset()` first and shows
`error.digest`, which on a production build is the only thing linking a crash to a server log.
`global-error.tsx` deliberately duplicates that screen instead of sharing it: it renders *in place
of* the root layout, so the stylesheet and both typefaces are precisely what is not guaranteed to
have loaded, and a Tailwind class there would be a name with nothing behind it.

All three ship as the game's own **NO CONTEST** — what Ultimate calls a match that ends without a
winner. A 404 and a crash are both the game stopping short, and the player already has a word for
that.
