# Playing Smash on a keyboard

Research lane 6. Fetched against SmashWiki, Smashboards, MDN, Deskthority and the control
documentation of three PC platform fighters, August 2026.

Smash was designed around an analog stick, and a laptop has none. This document is about
what is genuinely lost, what can be recovered by timing, and one hard finding about the
two control schemes the brief specified.

---

## 1. The finding that changed the design

**Config 1 and Config 2 cannot both be active at once**, and this is a property of the
layouts rather than a bug in the implementation. They are mirror images, so **six physical
keys carry opposite meanings** between them:

| Physical key | Config 1 | Config 2 |
|---|---|---|
| `KeyW` | jump | move up |
| `KeyA` | special | move left |
| `KeyD` | attack | move right |
| `ArrowUp` | move up | jump |
| `ArrowLeft` | move left | special |
| `ArrowRight` | move right | attack |

A `keydown` event carries no information about whose finger caused it. Bound naively, one
player pressing jump also fires the other player's up input, for two-thirds of both
schemes. Only `ArrowDown`/`Q`/`E` and `S`/`Shift`/`/` are actually disjoint. **HIGH** —
this is arithmetic, not a citation.

The brief asked for two configurations, the second being "the same but flipped". That is
exactly what a **mirrored preset for one player** is — a left-handed and a right-handed
layout. So they ship as alternatives a player chooses, `detectConflicts()` makes activating
two colliding schemes impossible, and a **third preset on a disjoint cluster** exists for
two people sharing one laptop. Recorded in DECISIONS D8.

### Two smaller hazards in the specified bindings

- **`/` opens Firefox's Quick Find**, which steals focus and means the game never sees the
  key release. `preventDefault` on `code === "Slash"` covers the common case; a visible
  focus container and re-focus on blur covers the rest. **HIGH** —
  [Mozilla Support](https://support.mozilla.org/en-US/questions/984845).
- **`Shift` held can trigger Windows Filter Keys** (~8s hold) or Sticky Keys (5 rapid
  taps), popping a system dialog that steals focus mid-match. Shield is a *held* input, so
  this is reachable in normal play. No page-level API can suppress it — only an onboarding
  note can. **HIGH**
- **`WASD` + `Shift` is the most commonly cited ghosting failure combination** on membrane
  keyboards, which is exactly "move while shielding" in Config 2. Config 1's cluster is
  safer because movement and action keys sit in different regions of the key matrix.
  **MED** — [Deskthority on rollover and ghosting](https://deskthority.net/wiki/Rollover,_blocking_and_ghosting).

---

## 2. Recovering analog meaning from digital keys

The stick does two jobs a key cannot: it reports *how far* and *how fast*. Four mechanics
key off that. The useful discovery is that **Smash's own internal checks are already
frame-window tests rather than continuous reads**, which is why the all-digital Smash Box
controller is tournament-legal. So the distinctions survive if the *timing* is right.

| Distinction | Real game | This implementation |
|---|---|---|
| Tilt vs. smash | attack pressed while the stick crossed 0.25 magnitude within the last 3–5 frames (sensitivity-dependent), reaching 0.66 | attack within **5 frames of a fresh direction-key edge** — a key press *is* "the stick just moved" |
| Walk vs. dash | stick enters the dash region within 2 frames of leaving the deadzone | direction held past **3 frames** upgrades a walk to a dash |
| Dash attack | attack while already running | unchanged — attack at run speed |
| Short vs. full hop | jump released within the 3-frame jumpsquat | unchanged |
| Fast fall | down flicked after apex | down pressed after apex, with an early press buffered to the apex |
| Drop through | fast downward flick on a soft platform | *easier* on a keyboard — a press already is a full deflection |
| SDI | each new directional input during hitlag is a pulse; tapping beats holding | maps **exactly**; mashing works identically with no adaptation |
| DI | magnitude and direction both matter | direction only — every keyboard DI is maximum-strength |

**HIGH** for the real-game figures —
[Smashboards on control stick buffering](https://smashboards.com/threads/control-stick-buffering.441575/),
[Dash](https://www.ssbwiki.com/Dash), [Short hop](https://www.ssbwiki.com/Short_hop),
[SDI](https://www.ssbwiki.com/Smash_directional_influence).

The one genuine loss is **partial DI**. On a keyboard every DI input is perfect DI, which
removes a real axis of skill expression. Nothing can recover it without an analog input,
which is why the Gamepad API path exists as a second-class citizen.

---

## 3. How other games solved it

- **Rivals of Aether** sidesteps magnitude entirely with a **separate "Strong" button** —
  Attack gives tilts, Strong gives smashes. It also ships a "hold direction + Attack =
  Strong" toggle. **HIGH** — [Mizuumi Wiki](https://mizuumi.wiki/w/Rivals_of_Aether/Controls).
- **Brawlhalla** drops the distinction completely: Light and Heavy buttons, no tilt/smash
  and no walk/dash. The lower bound of what happens if you stop trying. **MED**
- **Super Smash Flash 2** — the closest precedent, a keyboard-native Smash clone — tells
  its players outright to **turn tap jump off**, because a digital up key has only one
  state, so with tap jump on *every* up input becomes a jump and up-tilt is unreachable.
  It also notes dash cannot be reliably buffered from a double-tap on keyboard. **HIGH** —
  [SSF2 keyboard guide](https://medium.com/@smashflashbackroom/so-you-want-to-play-ssf2-how-to-control-the-game-with-a-keyboard-dc2935567c7b).
- **Competitive Smash players remap the C-stick to tilts** for the same underlying reason —
  one stick doing two jobs is hard to do consistently. **HIGH** —
  [A-sticking](https://www.ssbwiki.com/A-sticking).

The SSF2 finding is why **tap jump defaults off** here. Both schemes already give a
dedicated jump key, so there is no upside to it and a real cost to up-tilt reliability. It
remains a toggle.

---

## 4. Browser input mechanics

**Use `KeyboardEvent.code`, never `.key`.** `code` is the physical key position, so
`KeyW` stays where the player's hand is on AZERTY; `.key` would silently break WASD for
those users. `.keyCode` is deprecated and inconsistent. **HIGH** —
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code),
[Chrome for Developers](https://developer.chrome.com/blog/keyboardevent-keys-codes).

**The tap that vanishes.** `requestAnimationFrame` runs every ~16.7ms, but key events fire
asynchronously — a fast player can complete a full press *and* release between two frames.
Sampling "is the key down now" once per frame drops that tap entirely, which is fatal for
a short hop defined by a 3-frame release window. The fix is the latched pattern:
listeners update live state **and** accumulate `pressedThisFrame`/`releasedThisFrame` edge
sets which the simulation drains exactly once per tick. Implemented in
`src/input/keyboard.ts`. **HIGH**

**Input buffer** is 9 frames in Ultimate, down from 10 in Smash 4, with two mechanisms: a
classic pre-buffer, and a hold-buffer where holding a button through the end of an
animation fires it the instant the animation ends. Notably you **cannot** buffer a
full-hop aerial — an attack during jumpsquat always produces a short-hop aerial. **HIGH** —
[Buffer](https://www.ssbwiki.com/Buffer). The buffer is keyed off the simulation frame
counter rather than wall-clock time, so it stays rollback-safe.

**Gamepad API** is a pull model — poll `navigator.getGamepads()` once per tick and
edge-detect by diffing, since only connect/disconnect are events. Use a **radial**
deadzone (normalise the vector, zero below ~0.18, rescale from the edge) rather than
clamping axes independently, which biases diagonals. A stick restores walk/dash, tilt/smash
and partial DI natively — it is the cheap way to get the real feel back. **HIGH**

---

## Citations

- [Short hop](https://www.ssbwiki.com/Short_hop) · [Dash](https://www.ssbwiki.com/Dash) ·
  [Buffer](https://www.ssbwiki.com/Buffer) · [Tap](https://www.ssbwiki.com/Tap) ·
  [A-sticking](https://www.ssbwiki.com/A-sticking) ·
  [SDI](https://www.ssbwiki.com/Smash_directional_influence) ·
  [Air dodge](https://www.ssbwiki.com/Air_dodge)
- [Smashboards: control stick buffering](https://smashboards.com/threads/control-stick-buffering.441575/) ·
  [Smash Box controller](https://en.wikipedia.org/wiki/Smash_Box_controller)
- [Rivals of Aether controls](https://mizuumi.wiki/w/Rivals_of_Aether/Controls) ·
  [SSF2 keyboard guide](https://medium.com/@smashflashbackroom/so-you-want-to-play-ssf2-how-to-control-the-game-with-a-keyboard-dc2935567c7b)
- [MDN KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code) ·
  [Chrome: keys and codes](https://developer.chrome.com/blog/keyboardevent-keys-codes)
- [Deskthority: rollover, blocking and ghosting](https://deskthority.net/wiki/Rollover,_blocking_and_ghosting) ·
  [Key rollover](https://en.wikipedia.org/wiki/Key_rollover)
- [Game Accessibility Guidelines: remappable controls](https://gameaccessibilityguidelines.com/allow-controls-to-be-remapped-reconfigured/)
