# Making a browser fighting game feel real-time

Research lane 3. Fetched against GGPO's source and docs, Slippi write-ups, MDN, Vercel's
docs and several first-hand browser-rollback postmortems in August 2026.

The brief asked for multiplayer that genuinely feels real-time, and specifically to
exploit shared WiFi. This document is why the answer is *rollback over WebRTC*, and why
that choice reaches back into the engine's data structures rather than sitting on top of
them.

---

## 1. The two architectures

**Delay-based** holds your own input back until the opponent's arrives, so both machines
simulate the same frame with complete information. Simple and always correct — but every
player pays the full round trip in input lag, permanently.

**Rollback** shows your input immediately and *guesses* the opponent's, usually by
repeating their last one. When the real input arrives and disagrees, the game rewinds to
the last confirmed frame and re-simulates forward at speed. You never feel your own lag;
you occasionally see the opponent correct. **HIGH** —
[GGPO Developer Guide](https://github.com/pond3r/ggpo/blob/master/doc/DeveloperGuide.md),
[Tony Cannon, "Fight the Lag!"](https://www.gamedeveloper.com/programming/the-lag-fighting-techniques-behind-ggpo-s-netcode).

**Smash Ultimate itself is delay-based** — reportedly 5 frames of delay even locally,
dropping to ~2 on a good connection. Sakurai has said rollback was investigated and
abandoned over "adverse side effects". **HIGH** —
[Inverse](https://www.inverse.com/gaming/smash-ultimate-rollback-netcode-vs-delay-based).
Slippi later retrofitted rollback onto Melee and the difference is the single most praised
thing about it. **HIGH**

So this project is, on this one axis, deliberately *better* than the game it replicates.

### Where each breaks

| RTT | Rollback | Delay-based |
|---|---|---|
| < 80ms | corrections essentially invisible | ~5 frames of lag, tolerable |
| 80–150ms | visible but not disruptive | noticeably sluggish |
| > 150ms | teleporting, disruptive | unplayable for anything reactive |

GGPO caps prediction at **8 frames** (`MAX_PREDICTION_FRAMES`), ~133ms one-way, beyond
which it must stall. **HIGH** — [pond3r/ggpo](https://github.com/pond3r/ggpo).

A fair criticism worth recording: rollback is not free. A single 500ms spike forces a
30-frame resimulation, and that correction reads worse than an honest pause. **MED** —
[Antsstyle](https://antsstyle.medium.com/netcode-in-games-an-explanation-and-why-rollback-is-overrated-b76ee54ac2bb).
The engine therefore has a spike escape hatch: past a threshold it pauses rather than
attempting the correction.

---

## 2. Determinism in JavaScript — what is actually unsafe

This is the part that had to be designed in from the first line of code, because
retrofitting it is what nearly sank Slippi (ordinary Dolphin savestates were far too slow
to run every frame; a bespoke fast serialization path had to be built). **HIGH** —
[Rollback Netcode in Melee](https://medium.com/@dronh.to/rollback-netcode-in-melee-2712892fdb15).

**Safe, contrary to folklore:** basic IEEE-754 `+ − × ÷` and comparisons are fully
specified and bit-identical across conformant engines. `Math.sqrt` is correctly rounded
and also safe. `Array.prototype.sort` has been stable since ES2019. **HIGH**

**Genuinely unsafe:**

- **`Math.sin`, `cos`, `pow`, `exp`, `log`, `atan2`.** IEEE-754 marks transcendentals as
  *recommended*, not required — engines may legally differ in the last bits. This is the
  single most-cited cause of "worked for weeks, then silently desynced" in every browser
  rollback writeup found. **HIGH**
- **`Math.random`.** Implementation-defined and unseedable. **HIGH**
- **`Date.now` / `performance.now`.** Two machines are not synchronised. Fine for the
  networking layer; fatal inside the simulation. **HIGH**

**What this project does:** all simulation quantities are Q12 fixed-point integers;
trigonometry comes from an integer lookup table quantised at build time; randomness is a
seeded Mulberry32 whose state lives inside `GameState` and rolls back with it; elapsed
time is `frame / 60`. A layering test greps the engine for every banned call. This is the
same four-rule discipline an independent JS rollback implementation arrived at. **HIGH** —
[outof.pizza](https://outof.pizza/posts/rollback/).

### Snapshot cost

Three options were considered. `structuredClone` is a general recursive algorithm, not a
memcpy — convenient but allocation-heavy at 60Hz. Flat typed arrays with `TypedArray.set()`
are the fastest and what GGPO-style engines do, but writing game logic against integer
offsets is error-prone. Immutable structural sharing makes snapshots free and *writes*
expensive, which is backwards for a hot simulation loop.

This project uses **plain objects with an explicit hand-written `cloneState`**. Four
fighters of roughly forty numeric fields each is a few hundred field copies — trivially
inside budget for the ten snapshots a rollback window needs, and it keeps the physics code
readable. A benchmark test asserts the cost stays under budget. **MED** — directionally
supported by the sources; the specific figure is measured locally rather than cited.

---

## 3. Transport

`RTCDataChannel` configured `{ ordered: false, maxRetransmits: 0 }` — as close to raw UDP
as a browser offers. **HIGH** —
[MDN createDataChannel](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/createDataChannel).

A WebSocket is TCP: one lost packet stalls everything behind it until retransmission
completes, which is precisely the latency spike rollback exists to hide. Retransmission is
also pointless here — a resent input for frame N is worthless once the game is predicting
frame N+5.

**Loss is handled at the application layer instead.** Every packet carries a **window of
the last 10 frames** of input keyed by absolute frame number, so a dropped packet heals
itself 16ms later when the next one arrives carrying the same frames again. Prediction is
only needed if ten consecutive packets are lost. **HIGH** — this is GGPO's own convention.

Measured DataChannel round trips are ~10–15ms on WiFi and can be under 10ms on a LAN.
**MED** — [Mozilla's DataChannel latency test](https://mozilla.github.io/webrtc-landing/data_latency_test.html).
Keep packets well under **1200 bytes**, which is Chrome's internal safe ceiling before IP
fragmentation. **HIGH** — [BlogGeek.me](https://bloggeek.me/webrtcglossary/mtu-size/).

---

## 4. Shared WiFi comes free, and that is the point

The brief asked to exploit a shared network. The finding that shaped the design is that
**no code should special-case it**.

WebRTC's ICE gathers **host candidates** for every local interface. Modern browsers
publish these as `.local` mDNS hostnames for privacy, which a device on the same subnet
resolves back to a private IP transparently. When both peers are on one subnet,
connectivity checks succeed on host candidates alone — **no STUN, no TURN, no relay, no
server in the path**. **HIGH** —
[BlogGeek.me on mDNS candidates](https://bloggeek.me/psa-mdns-and-local-ice-candidates-are-coming/),
[Meetrix on STUN/TURN/ICE](https://meetrix.io/blogs/stun-vs-turn-vs-ice-webrtc-nat-traversal/).

So one signalling path is used for every match, and ICE's own candidate-pair
prioritisation discovers and prefers the LAN route whenever it exists. Two laptops on the
same WiFi get a direct, sub-10ms path without a line of code that knows what a LAN is.

---

## 5. Signalling, and what actually deploys on Vercel

The problem: two peers must exchange SDP offers before ICE can start, and Vercel's
serverless functions are invoked per-request and torn down — they cannot hold a socket.

Options examined:

- **Vercel native WebSockets** — in public beta as of mid-2026, but connections pin to one
  function instance, default to 5 minutes, and need Fluid Compute. Sufficient for a
  few-second handshake, but a beta dependency. **MED** —
  [Ably on WebSockets on Vercel](https://ably.com/vercel/websockets-on-vercel).
- **Edge SSE down + POST up** — builds a signalling channel on Vercel's GA primitives, but
  still needs shared state across invocations to pair two peers.
- **Hosted realtime** (Ably, PartyKit, Supabase) — generous free tiers, but a third-party
  account for a handshake.
- **Trystero** — peer discovery over existing public infrastructure (BitTorrent trackers,
  Nostr relays, MQTT). **No signalling server at all.** Deploys as a pure static addition,
   42KB, zero accounts, zero configuration. **HIGH** — [trystero.dev](https://trystero.dev/).

**Trystero was chosen**, behind a `Transport` port so the choice is reversible. Two other
adapters implement the same port: `BroadcastChannel` for two tabs on one machine (a real
feature as well as the fastest way to develop netcode), and an in-process loopback with
configurable latency, jitter and loss — which is what makes the rollback tests meaningful
rather than decorative.

A TURN fallback is *not* shipped. On the open internet, some NAT combinations will simply
fail to connect. That is an honest known gap rather than a hidden one, and it does not
affect the LAN case the brief actually asked about.

---

## 6. Frame pacing

`requestAnimationFrame`'s delta varies with refresh rate and is throttled to nothing in a
backgrounded tab — driving the simulation from it directly desyncs peers with different
monitors. The standard accumulator pattern applies: accumulate real elapsed time, call the
fixed 60Hz `step()` exactly as many times as fits, and **interpolate the render between
the last two simulated states** so a 144Hz display looks smooth without the simulation
ever leaving 60Hz. Clamp the accumulated time to avoid the spiral of death. **HIGH** —
[Gaffer On Games, "Fix Your Timestep!"](https://gafferongames.com/post/fix_your_timestep/).

Peers never synchronise wall clocks. They agree on a **frame number**, which is
structurally the same instant on both machines because the simulation is deterministic.
Drift is handled by GGPO's TimeSync approach: track how many frames ahead of the last
confirmed remote frame you are, and stall one when you get too far ahead. **HIGH**

Tab backgrounding is treated explicitly as a pause-and-resync event rather than left to
silently throttle. **HIGH** —
[johanhelsing, "Extreme Bevy"](https://johanhelsing.studio/posts/extreme-bevy) hit exactly
this during development.

---

## 7. Lessons taken from people who did this before

- **Design save/restore in from frame one.** Slippi had to build a bespoke fast
  serialization path because ordinary savestates could not run every frame. Retrofitting
  is the harder path every time it has been tried. **HIGH**
- **Build desync detection immediately, not later.** Determinism bugs are silent and only
  surface as absurd divergence far downstream. GGPO ships a SyncTest mode that forces a
  rollback every single frame and diffs the result; an independent browser implementation
  built periodic state-hash comparison in as a first-class feature for the same reason.
  This project exchanges a state hash every 30 frames. **HIGH** —
  [someusername6/rollback-netcode](https://github.com/someusername6/rollback-netcode).
- **A small fixed input delay is worth it.** Every shipping rollback game pairs rollback
  with 2–3 frames of delay so good connections barely roll back at all. Killer Instinct
  used 3; Extreme Bevy settled on 2. This project defaults to **2**. **HIGH**
- **Declare what participates in rollback.** Less snapshotted state means cheaper saves
  and fewer determinism surfaces. Cosmetic state — particles, camera shake, audio — is
  deliberately outside `GameState` here, so an eight-frame rollback does not replay eight
  frames of explosions. **HIGH**

---

## Citations

- [GGPO Developer Guide](https://github.com/pond3r/ggpo/blob/master/doc/DeveloperGuide.md) ·
  [pond3r/ggpo](https://github.com/pond3r/ggpo) ·
  [Tony Cannon, "Fight the Lag!"](https://www.gamedeveloper.com/programming/the-lag-fighting-techniques-behind-ggpo-s-netcode)
- [Infil, Fightin' Words netcode series](https://words.infil.net/w02-netcode-p4.html) ·
  [SnapNet on rollback](https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/)
- [Rollback Netcode in Melee](https://medium.com/@dronh.to/rollback-netcode-in-melee-2712892fdb15) ·
  [outof.pizza](https://outof.pizza/posts/rollback/) ·
  [Extreme Bevy](https://johanhelsing.studio/posts/extreme-bevy)
- [MDN createDataChannel](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/createDataChannel) ·
  [mDNS ICE candidates](https://bloggeek.me/psa-mdns-and-local-ice-candidates-are-coming/) ·
  [STUN vs TURN vs ICE](https://meetrix.io/blogs/stun-vs-turn-vs-ice-webrtc-nat-traversal/)
- [Trystero](https://trystero.dev/) ·
  [WebSockets on Vercel](https://ably.com/vercel/websockets-on-vercel)
- [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) ·
  [Floating Point Determinism](https://gafferongames.com/post/floating_point_determinism/)
