# fake-phone — Decision Log

Every non-obvious choice made building this project, with the reasoning and the
alternatives rejected. Written as the decisions were made, not reconstructed
afterwards.

Research backing each decision lives in `research/`: `ios-call-ui.md`,
`android-call-ui.md`, `instagram-live-ui.md`, `competitive-teardown.md`,
`web-platform-constraints.md`, `ai-voice-architecture.md`. Each of those files
tags its claims HIGH/MED/LOW confidence, because most of this UI is
system-private and has no published pixel spec.

---

## D1 — A safety tool, never a prank app

**Decision.** The word "prank" (and "joke", "trick", "fool") appears nowhere in
the product: not in the UI, the manifest, the README, or a comment. Every string
frames fake-phone as personal safety and de-escalation.

**Why.** This is not positioning, it is a hard constraint discovered in research.
Apple's App Store Review Guideline 1.1.6 bans prank-call apps outright and
explicitly states that "for entertainment purposes" disclaimers are not a
defence; Google Play's Deceptive Behavior policy is functionally identical. Real
rejections cite that clause. Since the App Store is a stated goal, prank framing
would make the product unshippable — and the safety framing is also the honest
one, because that is what the app is for.

**Rejected.** Dual-listing the same app under both a "Fake Call" and an "Escape
Call" name, which the research found a real competitor actively doing. It works,
and it is transparently an attempt to A/B-test past review.

---

## D2 — The app never touches emergency services, even fictionally

**Decision.** No persona may claim to be police, a dispatcher, or 911/999/112.
No screen simulates dialling an emergency number. A unit test greps the entire
persona catalog for those terms and fails the build if one appears.

**Why.** Beyond the store policy, faking an emergency report is a crime in most
jurisdictions, and a persona that says "this is the police, we're on our way"
converts a safety tool into evidence of an offence. Guardrails that live only in
a prompt are suggestions; a test over the catalog is a rule.

**Rejected.** A "police officer" persona as the most-deterrent option. It is
probably the most effective single deterrent, and that is exactly why it cannot
ship.

---

## D3 — You only ever call yourself

**Decision.** fake-phone never places, routes or disguises a call to another
person. There is no dialler, no phone number field that does anything, no
outbound anything.

**Why.** Apple rejects apps that let a user anonymise calls to a third party;
self-directed fake-incoming-call safety apps are a live, approved category. The
distinction is the whole basis on which this app is shippable.

---

## D4 — The app opens into a ringing call, and options hide behind the end-call button

**Decision.** `/` renders a ringing call immediately. No splash, no menu, no
consent interstitial. The only way to the home/settings surface is to end or
decline the call.

**Why.** The competitive teardown is unambiguous that multi-step activation is
the failure mode that sinks apps in this category — native competitors invested
in Back Tap, watch taps and widgets precisely to remove taps. Someone opening
this app is usually already in the situation it exists for. The inversion also
buys plausible deniability: a bystander sees a call being ended, not a settings
menu being opened.

**Rejected.** A conventional home screen with a "start call" button, which costs
a tap and a glance exactly when both are expensive.

---

## D5 — The ringtone plays through an `<audio>` element, never Web Audio

**Decision.** `ElementRingtonePlayer` uses `HTMLAudioElement`. There is no
`AudioContext` anywhere in the app.

**Why.** The iOS ring/silent switch mutes Web Audio but does not mute `<audio>`
elements — a documented WebKit behaviour rooted in the default `ambient` audio
session category. A ringtone built on Web Audio is silent on a phone set to
vibrate, which is most phones, which would defeat the entire product. Web Audio
would have been the more elegant way to synthesise the tone at runtime; being
elegant and inaudible is worthless here.

**Consequence.** Audio playback rights must be taken inside a user gesture and
held, because they do not survive a later `setTimeout`. `unlock()` exists for
exactly that, and the call controller calls it — plus `speech.warmUp()` —
synchronously inside the answer tap rather than in the effect that follows.

---

## D6 — The ringtone is synthesised by a script in this repo

**Decision.** `scripts/generate-audio.mjs` synthesises `ringtone.wav`,
`connect.wav` and `disconnect.wav` from scratch with no dependencies: a
struck-bar model with five inharmonic partials (1 / 2.005 / 3.94 / 6.02 / 9.85),
per-partial exponential decay, played as an A-major-pentatonic figure in two
bursts with a gap.

**Why.** Apple's "Reflection" and every Android system tone are copyrighted and
cannot ship. Commissioning or licensing a tone is not available to a one-shot
demo. Generating it makes the asset original, reproducible, reviewable as source
rather than as a binary blob, and free of any licensing question. The gap
between bursts is what makes it read as a phone rather than as music.

**Rejected.** A CC0 stock ringtone (still someone else's asset, with attribution
and provenance to verify), and runtime Web Audio synthesis (see D5).

---

## D7 — Icons are generated too, and the mark is not a phone

**Decision.** `scripts/generate-icons.mjs` writes real PNGs with a hand-rolled
encoder over `node:zlib`. The mark is a beacon — concentric rings radiating from
a filled centre.

**Why.** Same originality argument as D6. The mark deliberately does not depict a
handset: a home-screen icon that announces "fake call app" to someone glancing
over your shoulder is a safety problem, not a branding one.

---

## D8 — Two skins behind one contract, not one skin with a theme

**Decision.** `CallSkinProps` is a pure view model. `IosCallSkin` and
`AndroidCallSkin` render it and own no state. The controller (`useCallController`)
owns every side effect.

**Why.** The two platforms genuinely disagree about more than colour: iOS answers
with two bottom-anchored circles and Android with a horizontal swipe pill; iOS
uses frosted material and Android tonal elevation; iOS shows `0:07` where Android
shows `00:07`. A themed single component would have accumulated a branch per
difference. As it is, behaviour is asserted once in e2e through shared test ids,
and a skin can only differ in appearance. An e2e test compares the rendered
geometry of the two end-call buttons and fails if a "second skin" is a recolour.

---

## D9 — Three voice tiers, defaulting to scripted, with AI wired but unlit

**Decision.** `silent` / `scripted` / `ai`. Scripted is the default.
`createVoiceProvider` walks `ai → scripted → silent`, calling each provider's
`isAvailable()`, and **never throws and never returns null**.

**Why.** We have no API key, so AI can never be the default — but the seams must
be real, or "add a key to enable it" is a promise nobody can keep. Making
degradation a property of the factory rather than a branch in the UI means the
unconfigured state is the ordinary, tested path rather than an error path. With
an empty environment the routes return a typed `503 voice_unconfigured`, and e2e
asserts that against a real running server.

**Rejected.** Hiding the AI option until a key exists. The UI now shows it,
greyed, with a one-line explanation — `aria-disabled` rather than `disabled`,
because a `disabled` button is dropped from the accessibility tree and this
option's entire job is to be seen.

---

## D10 — Scripted dialogue is timed by the script, not by the speech engine

**Decision.** `ScriptedVoiceProvider` emits `line` and `listening` events on
script timing. When `speechSynthesis` is unavailable it paces on reading speed
instead, and it pads any `speak()` that returns implausibly fast.

**Why.** iOS speech synthesis is unreliable in documented, specific ways: the
voice list is empty until a `voiceschanged` event, utterances are cut when
backgrounded, and an engine with no voice loaded resolves `speak()` instantly —
which would run an entire call in under a second. Since scripted is the *default*
tier, it has to be convincing when the platform gives us nothing. Subtitles are
on by default for the same reason: a silent call that still shows the caller
talking reads as real; a silent call that shows nothing reads as broken.

---

## D11 — Listening pauses are the product, not padding

**Decision.** Every dialogue line carries a `pauseAfterMs` between 1200 and
3500ms, and personas use short lines, backchannel openers, and concrete
proximity cues ("I'm turning onto your street", "I can see the shop on the
corner").

**Why.** No public scripts from existing apps exist to copy — the research
established that they all ship pre-recorded audio — so these rules come from
general phone-call realism. The gap where the other person replies is what makes
a one-sided call sound like a call rather than a voice memo. Proximity cues are
what make it a deterrent rather than a conversation.

---

## D12 — The ring delay is capped at 60s and the limitation is stated on screen

**Decision.** Offered delays are 0/5/15/30/60s, and the UI permanently displays:
a delayed call only arrives while the screen stays on.

**Why.** Mobile Safari suspends timers and audio when the screen locks. A delay
long enough to pocket the phone is a delay long enough to silently fail. The
single most repeated one-star review in this category is "it never rang" — always
from apps that promised background ringing the platform cannot deliver. Real
background triggering needs Web Push plus a backend (and iOS Web Push cannot play
a custom sound anyway), or native local notifications. That is recorded as a
known gap in the README rather than half-built.

---

## D13 — Live mode replicates the pattern, not Instagram

**Decision.** The live surface uses a red LIVE badge, an adjacent viewer-count
pill, a rising comment stream and floating hearts — and ships no Instagram
wordmark, no camera-glyph logo, no pink→orange→yellow brand gradient, and no
string naming Instagram.

**Why.** That badge/comments/hearts pattern is category-standard across
Instagram, TikTok, YouTube and Twitch, so it reads correctly to a bystander who
has never used Instagram while carrying far lower trade-dress risk than reusing
Instagram's specific brand assets. The brand gradient is the single
highest-risk asset and is the one thing most clones copy first.

---

## D14 — The camera stream is video-only

**Decision.** `getUserMedia({ video: …, audio: false })`. Nothing is recorded or
transmitted; the stream is rendered locally and torn down on unmount.

**Why.** Requesting audio would add a second permission prompt for no visual
benefit, and recording audio of a conversation puts the app near two-party-consent
recording law in thirteen US states. Neither cost buys anything the illusion
needs.

---

## D15 — Ports and a single composition root, even for a demo

**Decision.** Every platform surface — ringtone, speech, camera, storage,
haptics, wake lock, voice provider — sits behind an interface in `src/ports/`,
implemented in `src/adapters/`, and constructed only in `src/lib/container.ts`.
Components may never import an adapter.

**Why.** This app is almost entirely made of hostile platform quirks, and the
quirks are the thing most likely to change (they have regressed across iOS point
releases repeatedly, per the research). Quarantining each one behind an interface
means the day `navigator.vibrate` ships in Safari, or the day this is wrapped in
Capacitor and gains real local notifications, the change is one adapter and one
line in the container. It is also what makes the domain unit-testable with no
browser at all.

---

## D16 — Settings parsing repairs rather than throws

**Decision.** `parseSettings` validates the whole object, and on failure falls
back **field by field**, keeping every field that is individually valid.

**Why.** A safety tool must open into a ringing call even when its stored
settings are from an older build, were hand-edited, or were truncated by a
storage quota. All-or-nothing parsing would discard a carefully configured caller
name because one unrelated field went bad.

**Bug found by this decision's test.** Zod 4 treats a `.default()` value as an
*output* that bypasses parsing, so `.default({})` on the nested `caller` group
produced a literally empty object — a call screen with no caller name, a total
silent product failure. Nested defaults are now pre-parsed.

---

## D17 — Photos are downscaled to 512px before storage

**Decision.** `fileToDownscaledDataUrl` draws the chosen photo to a canvas capped
at 512px on the long edge and re-encodes as JPEG at 0.82, rejecting rather than
falling back to the original bytes.

**Why.** A modern phone photo as a data URL is several megabytes against a ~5MB
`localStorage` budget. The store already degrades gracefully on quota failure, but
the user should never reach that path. Falling back to the original bytes would
defeat the entire purpose of the function.

---

## D18 — SSE for the AI tier, not WebSockets

**Decision.** `/api/voice/turn` streams over Server-Sent Events. The API key is
read server-side only; the browser never sees it.

**Why.** A fake call is one-sided — server to client only — so the simplest
correct transport wins, and SSE is the one that works cleanly on Vercel's
function model. WebRTC remains the right answer for a true speech-to-speech
provider, and the session route is where an ephemeral browser credential would be
minted; that seam exists and is commented.

---

## D19 — Timers are derived from a timestamp, never accumulated

**Decision.** `elapsedSeconds(state, now)` recomputes from the connect timestamp
on every tick.

**Why.** Mobile Safari throttles background intervals. A counter incremented per
tick silently loses the throttled seconds and comes back wrong; a derived one is
correct the instant the tab is visible again. The call timer is the single most
scrutinised number on the screen.

---

## D20 — Base CSS resets live in `@layer base`, custom classes stay unlayered

**Decision.** The element resets (`html`, `body`, `input`, `button`) are wrapped
in `@layer base`. The custom helper classes (`.app-frame`, `.pad-safe-*`,
`.tabular`) are deliberately left unlayered.

**Why — this one shipped as a bug first.** Tailwind 4 emits utilities into
`@layer utilities`, and in the CSS cascade an *unlayered* rule beats a layered
one outright; specificity is only compared within a layer. An unlayered
`button { background: none }` therefore silently defeated `bg-ios-green` on every
button in the app. The class was in the markup, the utility was in the
stylesheet, the custom property resolved to `#30D158` — and the Accept button
still rendered transparent. It was only caught by *looking at a screenshot*,
because every test was green: nothing asserted a colour.

The helpers stay unlayered for the opposite reason: both skins were built against
`.pad-safe-bottom` winning over Tailwind's `pb-*`, and quietly reversing that
would have moved layout in two slices at once.

**Consequence.** A component that needs both a safe-area inset and a padding
utility puts them on *separate* elements. Both skins do this; the one place that
did not had its swipe pill flush against the bottom edge on every device without
a home indicator.

---

## D21 — The settings panel is inert until it hydrates

**Decision.** While `hydrated` is false, the settings panel is `inert`, not just
faded out.

**Why.** Before hydration those are server-rendered inputs with no React
listeners attached. A keystroke landing in that window changes the DOM, is seen
by no handler, and is wiped when React hydrates and re-asserts the controlled
value. Refusing the edit is honest; accepting one we are about to throw away is
not. This surfaced as a 1-in-3 flaky e2e failure — a real race that a fast driver
hits and a fast user occasionally would too.

---

## D22 — A voice session is a signed token, not a server-side record

**Decision.** `/api/voice/session` mints an HMAC-signed token carrying the session
id, persona, issue time and expiry. `/api/voice/turn` verifies the signature and
derives elapsed time from the *signed* issue time. `elapsedSeconds` and
`tokensUsed` were removed from the request schema entirely. Token spend is
reserved before the model call, not recorded after it.

**Why.** Two failures, one after the other.

The first was trusting the client: those counters came from the browser, so a
caller could post any session id with both reset to zero on every request and
drive unbounded billable model calls past the caps. A budget enforced by the
party being budgeted is not a budget.

The obvious fix — a server-side session store — was a module-level `Map`, and the
two routes are *separate serverless functions* on the documented deploy target.
A session minted by one would be unknown to the other, so the AI tier would not
have worked on Vercel at all. Signing the session makes the server the authority
with no shared state to lose: the duration cap is exact on every instance, and
the client still cannot forge or extend a session.

Reserving before spending closes the second half. Reading usage, awaiting the
model, then recording usage lets three overlapping turns each see the same
figure and each take a full allowance — 1,200 tokens against an 800 cap, which is
what the test now proves against the old ordering.

**Consequence, stated plainly.** Token accounting is still per-instance and
best-effort: a call whose turns land on N instances can spend up to N times its
token budget. The *duration* cap is exact everywhere. Only shared storage
(Vercel KV, Redis) makes the token side exact, and the ledger module says so.

---

## D23 — A rejected camera `flip()` guarantees no camera is running

**Decision.** When switching cameras fails, the adapter does not restore the
previous stream and rethrow. A rejection means nothing is live. Recovery — where
the previous facing is known — happens one layer up, in the hook.

**Why.** The original code re-acquired the previous camera, kept it, and then
threw. The UI treats a rejection as "the camera is off", drops its preview, and
shows the error state — while the hardware indicator stays lit with nothing on
screen. In a safety app, a camera the user believes is off but which is actually
running is the worst bug available. The port's doc comment now states the
guarantee, because it is a contract, not an implementation detail.

**Rejected.** Resolving with the restored stream. `flip()` returns a bare
`MediaStream` with no way to say *which* camera came back, so the caller would
record the facing it never got — an un-mirrored selfie and a desynced next flip.

---

## D24 — The voice effect is keyed on the whole call, not on "connecting"

**Decision.** The effect that owns the voice session depends on `isOnCall(state)`
— one boolean true for both `connecting` and `active` — rather than on
`phase === "connecting"`.

**Why — this was the worst bug in the project, and it shipped green.** Keyed on
the phase, the effect was torn down *the instant the call connected*: the
provider emits `connected`, the reducer moves to `active`, the dependency
changes, and React runs the cleanup that aborts the very session about to speak.
Every real provider pauses between lines, so the caller delivered its first line
and then went silent for the rest of the call — on the **default** tier.

It survived everything. Unit tests used fake providers that yield synchronously,
so the whole event stream was consumed before React committed the first state
update. The e2e asserted only that *a* subtitle appeared, which the first line
satisfied. It took an independent reviewer reading the dependency array to see
it, and a test with a deliberate `await` between events to prove it.

**The lesson, kept:** a fake that is faster than reality is not a fake, it is a
different system. `providerEmittingSlowly` exists in the controller's tests for
exactly that reason, and the e2e now asserts a *second* line rather than a first.

---

## D25 — Development ran as parallel slices against a frozen contract

**Decision.** The foundation (domain, ports, container, tokens, app shell) was
built and committed first; six slices then ran concurrently against it on
strictly disjoint file sets, with exact module paths and export signatures fixed
in advance.

**Why.** The alternative — agents negotiating interfaces while writing against
them — produces merge conflicts and interface drift. Fixing the seams first meant
`src/lib/container.ts` could import modules that did not exist yet, and every one
of them arrived with the right shape. The e2e suite was written against those
same contracts before any slice finished, which is what caught the missing
`aria-pressed` semantics early enough to be a message rather than a rework.
