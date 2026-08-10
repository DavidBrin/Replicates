# fake-phone — Build Spec

> **never feel alone**

A personal-safety web app. When someone feels uneasy — walking home, waiting for
a ride, cornered in a conversation they want out of — they open fake-phone and a
call arrives. To anyone watching, someone knows where they are and is on the way.

Every requirement below is derived from `research/` (six parallel research lanes,
completed before this spec was written). Where a number is an estimate rather
than a sourced fact, the research file says so and this spec inherits that
caveat.

---

## 1. Product framing (non-negotiable, from `competitive-teardown.md`)

fake-phone is a **safety and de-escalation tool**. This is not marketing gloss —
it is a hard product constraint with three consequences that bind every string,
screen and commit in this repo:

1. **No "prank", "joke", "trick" or "fool" language anywhere** — not in the UI,
   the README, the manifest, or a code comment that could end up in a store
   listing. Apple's App Store Review Guideline 1.1.6 bans prank-call apps
   outright and explicitly refuses "for entertainment purposes" disclaimers as a
   defence. Google Play's Deceptive Behavior policy matches it.
2. **The app never claims, implies or simulates contact with emergency
   services.** No 911/999/112, no "police", no dispatcher personas. Beyond
   policy, filing or faking an emergency report is a crime in most
   jurisdictions.
3. **You only ever call yourself.** fake-phone never places, disguises or routes
   a call to a third party. Apple rejects apps that anonymise calls to other
   people; self-directed fake-incoming-call safety apps are a live, approved
   category.

The one-line description used everywhere: *"A staged incoming call, so you never
feel alone."*

---

## 2. Modes and the entry contract

### 2.1 The app opens **into a ringing call**

There is no splash screen, no home screen, no menu on launch. Cold-boot renders
the incoming-call screen already ringing, because the product is used
one-handed, under stress, often without looking. The competitive research is
unambiguous that multi-step activation is the failure mode that kills these apps
in review.

**The end-call button is the way out.** Ending (or declining) the call reveals
the home/settings surface. This is the only navigation into options — it is a
deliberate inversion, and it doubles as plausible deniability: a bystander who
glances over sees a phone call being ended, not a settings menu being opened.

### 2.2 Call voice tiers

| Tier | id | Sound | Default | Needs |
|---|---|---|---|---|
| **Silent** | `silent` | None — photo, name, ringtone, live timer only | | nothing |
| **Scripted** | `scripted` | A written half-conversation, spoken aloud with realistic listening pauses | ✅ **default** | nothing |
| **AI** | `ai` | A live LLM-driven conversation | never default | an API key |

The AI tier is **fully wired and inert**. Every interface, route, registry entry
and env var exists; with no key configured the factory silently returns the
scripted provider. Adding a key is the only step needed to light it up.

### 2.3 Live-stream mode

A second mode that presents the phone as **actively broadcasting a live stream**,
with the real front camera on screen: a LIVE badge, a rising viewer count, a
scrolling comment feed and floating hearts. Same deterrent logic — the implicit
claim is "many people are watching this right now."

Per `instagram-live-ui.md`, this replicates the *pattern* (which is common to
Instagram, TikTok, YouTube and Twitch) and **not Instagram's brand**: no
wordmark, no camera glyph logo, and specifically not the pink→orange→yellow
brand gradient, which is the single highest trade-dress risk asset.

### 2.4 Skins

The call UI ships two skins, selectable in settings, defaulting to **iOS**:

- `ios` — post-iOS-17 layout (`research/ios-call-ui.md`)
- `android` — Material 3 Expressive / Google Phone (`research/android-call-ui.md`)

A skin is a pure renderer over one shared `CallViewModel`. Adding a third skin
must not require touching the call state machine, the audio layer or settings.

---

## 3. Architecture

### 3.1 Layering (enforced by import direction)

```
components/  →  domain/  ←  adapters/  →  ports/
      ↘            ↑                      ↗
       lib/container.ts (the only module that constructs adapters)
```

- **`src/domain/`** — pure TypeScript. No DOM, no React, no browser API, no
  provider SDK. The call state machine, the dialogue engine, formatting rules,
  settings schema and the live-session model live here and are unit-tested
  without a browser.
- **`src/ports/`** — interfaces only. `RingtonePlayer`, `VoiceProvider`,
  `CameraSource`, `SettingsStore`, `Clock`, `Haptics`, `WakeLock`.
- **`src/adapters/`** — the browser implementations, one folder per platform
  surface. Every hostile platform quirk in §4 is quarantined here.
- **`src/components/`** — React. Depends on domain types and port interfaces,
  never on a concrete adapter.
- **`src/lib/container.ts`** — the composition root, and the only place a
  concrete adapter is named.

The rule that makes this real: **a component may never import from
`src/adapters/`.** A lint-level convention plus a unit test that asserts the
import graph.

### 3.2 The call state machine (`domain/call-session.ts`)

```
idle → ringing → connecting → active → ended
         ↓                       ↓
      declined ─────────────────→ ended
```

Pure, synchronous, driven by an injected `Clock`. It owns the elapsed-time
counter and emits the view model; it knows nothing about audio, React or timers.

### 3.3 Voice provider abstraction (`ports/voice.ts`)

```ts
export interface VoiceProvider {
  readonly id: VoiceProviderId;
  isAvailable(): boolean;
  start(persona: Persona, signal: AbortSignal): Promise<VoiceSession>;
}
```

`VoiceSession` emits a `CallEvent` union (`speaking` | `listening` | `line` |
`error` | `ended`) and nothing else. Implementations:

- `SilentVoiceProvider` — emits nothing; always available.
- `ScriptedVoiceProvider` — walks a `DialogueScript` through a
  `SpeechSynthesizer` port, honouring per-line listening pauses.
- `AiVoiceProvider` — talks to `/api/voice/*`; `isAvailable()` is false with no
  key.

`createVoiceProvider(config)` **never throws and never returns null** — it walks
the requested tier down to `scripted`, then `silent`. Graceful degradation is a
property of the factory, not a branch in the UI.

### 3.4 Server boundary

Two Route Handlers, both no-ops without a key:

- `POST /api/voice/session` — mints a short-lived session (and, for providers
  that support browser-direct connections, an ephemeral credential). Returns
  `503 { code: "voice_unconfigured" }` when unconfigured.
- `POST /api/voice/turn` — streams the caller's next line back over SSE.

**The API key never reaches the browser.** Keys are read server-side only, from
`process.env`, in a module marked `server-only`.

Env contract (all optional; absence is a supported, tested state):

```
VOICE_PROVIDER=scripted|ai          # override only; inferred from key presence
AI_PROVIDER=anthropic|openai        # default anthropic
ANTHROPIC_API_KEY=                  # the only variable actually required
OPENAI_API_KEY=                     # declared seam, no client in this build
VOICE_CALL_MAX_DURATION_SECONDS=240
VOICE_CALL_MAX_TOKENS=2000
NEXT_PUBLIC_VOICE_AI_ENABLED=true   # build-time client gate; the server route
                                    # stays the authority and still 503s
                                    # without a key
```

---

## 4. Platform constraints that shape the build (`web-platform-constraints.md`)

These are the five findings that changed the architecture. Each has a required
mitigation, and each mitigation lives in an adapter.

| # | Constraint | Required mitigation |
|---|---|---|
| 1 | **The iOS silent switch mutes Web Audio but not `<audio>` elements.** A ringtone played through `AudioContext` is silent on a phone set to vibrate — which is most phones, which would defeat the entire product. | The ringtone plays through an **`<audio>` element**, never raw Web Audio. Set `navigator.audioSession.type = "playback"` where available. |
| 2 | **Autoplay only survives inside transient activation.** A `play()` called from a `setTimeout` that fires seconds later throws `NotAllowedError`. | Unlock the audio element on the *scheduling* tap (play a silent buffer), keep it alive, and never re-acquire playback rights from a deferred callback. |
| 3 | **Timers and audio are suspended when the screen locks.** A client-side scheduled call will not ring with the screen off. | Delay is capped and the UI states the constraint plainly ("keep this screen on"). Request a **Wake Lock**. True background triggering needs Web Push + a backend, or native local notifications — documented as a known gap, not silently broken. |
| 4 | **`navigator.vibrate` does not exist on iOS Safari.** | Haptics go behind a `Haptics` port that is a no-op on iOS web. Real haptics are an explicitly-scoped native-wrapper feature, never promised in the PWA. |
| 5 | **`speechSynthesis` on iOS is unreliable** — empty voice list until `voiceschanged`, speech cut when backgrounded, needs a gesture. | The synthesizer is a port with a warm-up-on-gesture step. `ScriptedVoiceProvider` degrades to on-screen subtitles when speech fails, so the call still reads as real. |

Additional required behaviours: `viewport-fit=cover` + `env(safe-area-inset-*)`,
`100dvh` (never `100vh`), disabled overscroll/pull-to-refresh, disabled
long-press callout, text selection and double-tap zoom, and
`apple-mobile-web-app-*` meta tags alongside the manifest.

---

## 5. UI specification

Full pixel detail lives in the research files; each slice reads its own. The
binding summary:

### 5.1 iOS incoming call
Full-bleed photo with a bottom scrim, or a dark gradient (`#3A3A3C → #1C1C1E`)
with a large SF-Compact-Rounded-style monogram. Name in the upper third
(~30pt/600, white). Subtitle below at ~80% opacity. **Bottom-anchored two-row
button stack** — a small secondary row (Message / Remind Me), then the primary
row: Decline `#FF453A` left, Accept `#30D158` right, ~80pt circles, icon-only.
The pre-iOS-17 centred single row is the most common replica mistake and is
explicitly out of spec.

### 5.2 iOS active call
Name + timer at top. Timer is `M:SS` under an hour and `H:MM:SS` at/after it —
first tick reads `0:01`, not `00:01` — in tabular figures so it does not jitter.
**3×2 grid of ~72pt frosted-glass circles** (`rgba(255,255,255,0.16)` +
`backdrop-filter: blur(20px) saturate(180%)`) that **invert to solid white with
a dark icon when toggled** — the second most-missed detail. Large red end-call
circle bottom-centre, handset rotated 135°.

### 5.3 Android
Material 3 Expressive: dark surface `#1C1B1F`, `onSurface` `#E6E1E5`,
`surfaceContainerHigh` `#2B2930`. Answer stays a **circle**; decline and
end-call are **stadium pills**. Google Sans (OFL since Dec 2025) with Roboto
fallback. Emphasized-decelerate easing `cubic-bezier(0.05, 0.7, 0.1, 1.0)`.

### 5.4 Live mode
Z-order: camera feed → top and bottom scrims → LIVE badge + viewer pill
(top-left, adjacent) and ✕ (top-right) → comment stream (lower-left, stacked
bottom-up, avatar + bold username + message) → floating hearts (rise from
bottom-right with a sine wobble) → bottom bar (comment pill reading
`Add a comment…`, then the icon row).
Viewer count: exact under 1,000, then `X.XK`, then `XXXK`, then `X.XM`.

### 5.5 Home / settings (our own surface, not a replica)
Dark and calm: `#0B0B0F` ground, `#17171C` cards, warm amber `#FFB340` accent
that reads as a beacon without competing with the call-green. Lowercase
wide-tracked slogan. Controls sized for one-handed reach in the lower two-thirds
of the screen; the primary "start a call" action is always the largest,
lowest-reachable thing on screen.

Configurable: caller name, relationship/subtitle, photo, skin, ring delay, voice
tier, persona, live-mode username, avatar, viewer count and comment rate.

---

## 6. Sound assets

We cannot ship Apple's "Reflection" or any Android system ringtone — they are
copyrighted. fake-phone **generates its own ringtone as a build artifact**: a
`scripts/generate-audio.mjs` synthesises original WAV files (a soft
marimba/bell-style arpeggio loop, a connect click, an end-call tone) with no
dependencies and no third-party audio. Original work, zero licensing exposure,
no network fetch at runtime.

---

## 7. Slices

| # | Slice | Owns |
|---|---|---|
| S1 | **Foundation** | tokens/globals, app shell + PWA, `domain/`, `ports/`, container, settings store |
| S2 | iOS skin | `components/call/ios/**` |
| S3 | Android skin | `components/call/android/**` |
| S4 | Audio + scripted voice | `adapters/audio/**`, `adapters/speech/**`, `domain/dialogue*`, `domain/personas*`, `scripts/generate-audio.mjs` |
| S5 | AI provider + routes | `adapters/voice/ai*`, `app/api/voice/**`, `lib/voice-config.ts` |
| S6 | Live mode | `components/live/**`, `adapters/camera/**`, `domain/live-session*` |
| S7 | Home / settings | `components/home/**`, `components/settings/**` |
| S8 | Verification + docs | `e2e/**`, README, DECISIONS |

S1 lands first and is the contract every other slice builds against. S2–S7 then
run in parallel on **disjoint file sets** — no two slices write the same file.

## 8. Definition of done

- `npm run typecheck`, `npm run lint`, `npm run test` green.
- `npm run build` green from clean.
- Playwright e2e green on the mobile projects, including a real camera-permission
  path for live mode.
- Screenshots captured at iPhone viewport for every surface.
- README (index, usage, deploy, known gaps) and DECISIONS.md written.
- No API key required for anything that is on by default.
