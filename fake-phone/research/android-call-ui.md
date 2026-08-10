# Android Phone Call UI — Pixel-Level Replication Spec

Target: Google Dialer / "Phone by Google" stock app, Android 14/15/16, Material 3 → Material 3
Expressive (redesign rolled out gradually June–Sept 2025, wide by app v186+). Written for an
engineer building an HTML/CSS replica. Every numeric claim is tagged **[HIGH]/[MED]/[LOW]**
confidence — see the confidence key at the bottom.

> Caveat up front: `m3.material.io` is a JS-rendered SPA that this research pass could not
> scrape directly (WebFetch returned only the page shell). The Material 3 token values below
> (hex codes, type scale sp/line-height, motion durations/easing, shape-scale dp) are the
> well-published, unchanged-since-2021/2023 **baseline M3 spec** reproduced from training
> knowledge, not re-verified against a live render this session. They are extremely stable and
> widely mirrored (Jetpack Compose `androidx.compose.material3` ships these exact literals), so
> confidence is **MED-HIGH** on the tokens themselves, but you should spot-check against
> `m3.material.io` or `androidx.compose.material3.tokens.ColorDarkTokens` /
> `TypographyTokens.kt` in the AndroidX source before finalizing pixel-critical values. The
> *behavioral/qualitative* claims about the current Google Phone app redesign (swipe gestures,
> button morphing, layout) come from live 2025 teardown articles fetched this session — those
> are HIGH confidence but describe an app that is still A/B testing, so some devices will show
> the old UI.

---

## 1. Incoming call screen

### 1.1 Two eras you need to pick between

Google Phone has shipped (and is still partially A/B-testing) **three** incoming-call
interaction models. A replica should probably implement the *current default* (1.1c) but it's
worth knowing all three exist because "the Android call screen" isn't one fixed design:

**(a) Legacy vertical swipe [HIGH]** — single circular button in the bottom-center; drag it
up to answer, drag down to decline. This was the Pixel/AOSP default for years (Android
10–15-ish) and is what most people picture as "the Android call screen." Text hints "Swipe up
to answer" / "Swipe down to decline" fade in above/below the button as you touch it.

**(b) iOS-style two-button variant [HIGH]** — tested Sept 2024: dedicated circular Accept
(green) and Decline (red) buttons side by side at the bottom, tap instead of swipe — explicitly
described in coverage as mirroring iOS 18's button layout. Source: Android Police, "Google is
changing how you answer calls with a major Phone app redesign."

**(c) Current default — horizontal swipe pill [HIGH, as of Aug 2026]** — replaced (a) as the
production default with the Material 3 Expressive rollout. A single **pill-shaped** (stadium /
fully-rounded) container sits at the bottom of the screen with a centered phone-ringing icon
that has a subtle ringing/wiggle animation. The word "Decline" is rendered in red on the left
half of the pill and "Answer" in green on the right half; swiping the central icon left declines,
right answers. After ~1 second the red/green text settles to a neutral color (described by
Android Authority's teardown as turning black), and reverts to red/green again mid-swipe as
visual feedback. A **Settings → "Incoming call gesture"** toggle lets the user pick between this
horizontal-swipe pill and a **discrete tap-buttons mode** (functionally (b), but now stacked/
positioned per M3 Expressive rather than the 2024 iOS-mirroring layout). Preference keys found
in APK teardown: `answer_method_preference_list_key`, `answer_method_swipe_entry`,
`answer_method_tap_entry`. [Source: Android Authority APK teardown, Aug 2025]

Google's stated rationale for moving off simple swipe-up/down: reduce accidental
answer/decline when the phone is pulled out of a pocket. [Source: Android Police, Android
Authority]

**Recommendation for the replica:** build (c) as the primary interaction (it's the current
shipped default and the most visually distinctive/"Android-native" of the three), with the
big circular Accept/Decline pair as a secondary/simplified fallback mode — this also gives you
an easy way to demo "Android vs iOS" side by side later since (b) is structurally identical to
iOS's button pair.

### 1.2 Layout geometry [MED — no exact px/dp published; reconstructed from screenshots+description]

- Full-bleed screen, status bar present but call apps typically request `FLAG_SHOW_WHEN_LOCKED`
  and hide most status icons except the clock and network/battery.
- Top third: small "Incoming call" / carrier label (optional, often omitted in current design —
  the redesign explicitly **removed** the "call from [carrier]" text label per the Android
  Authority teardown).
- Center: **caller photo** — now much larger than the pre-2025 design. Round avatar (M3 circular
  container), with a subtle animation on the photo before answering (e.g., a soft pulsing ring
  or the "squiggly" animated circle mask Android Police describes appearing during in-call state;
  teardown language is not fully consistent between outlets, treat the exact shape-morph as
  **[LOW]** confidence and the "larger photo/name" fact as **[HIGH]**).
- Below photo: **caller name**, large and bold — "much larger contact names" per Android
  Authority. Map this to Material 3 `headlineLarge` or `displayMedium` (32–36sp+, see §3).
- Below name: subtitle — phone number/label ("Mobile", "Work"), or call type ("Incoming call",
  "Spam likely", "Verified business call" badge for RCS/verified calls). In the current design
  the raw phone number is deferred to *after* answering rather than shown on the ringing screen
  [Android Authority].
- Bottom safe area: the interaction pill/buttons described in §1.1c, generally inset ~24–32dp
  from the bottom edge, full-width minus ~16–24dp side margins.
- Secondary affordances above the main answer control: quick-reply message icon (bottom-left)
  and mute-ringtone icon, present in most Pixel-era incoming-call screens historically; confirm
  presence in the 2025 redesign screenshots before including — **[LOW]** whether these persist
  unchanged.

### 1.3 Colors [MED — role names HIGH, exact hex MED]

- Background: dynamic, either full-bleed blurred/dimmed caller photo, or (no photo) a solid
  `surface`/`surfaceContainerLowest` dark fill. Pixel's Material You dynamic color extracts a
  seed color from the user's wallpaper at the OS level; a replica should just pick one fixed
  dark theme rather than try to fake dynamic theming.
- Answer text / accept affordance: Material's semantic "positive" mapping is typically
  `primary`/`primaryContainer` roles tinted green (Google doesn't use a literal `#00FF00`;
  it's a tonal green consistent with the M3 palette generation). Common literal green used in
  the legacy AOSP dialer's accept icon: **`#1E8E3E`**-ish Google green family, but the current
  redesign explicitly text-colors it — treat as `error`/`tertiary`-adjacent green token, not a
  hardcoded brand green. **[LOW]** exact hex — recommend using a standard Material green
  (`#34A853` Google-brand green, or M3 `tertiary` tonal green) as a defensible stand-in.
- Decline text / decline affordance: red, mapped to the M3 `error` role family
  (`error`/`errorContainer`/`onErrorContainer`). Recommend `#F2B8B5`/`#8C1D18` dark-theme error
  tokens (see §3) or plain Google red `#EA4335` for a punchier look.
- **[LOW]** No outlet published exact hex captured from the pill; use the M3 `error` role for
  decline and a green tonal equivalent for answer — this is a reasonable, defensible
  reconstruction, not a confirmed pixel-sampled value.

### 1.4 Icon set

- Material Symbols (the current icon font, successor to Material Icons) names to use:
  `call` (phone-ringing icon in the swipe pill), `call_end`, `message` (quick-reply),
  `notifications_off`/`volume_off` (mute ringtone), `person`/`account_circle` (fallback avatar).
  **[MED]** — these are the standard Material Symbols names; not confirmed against decompiled
  resource names for this exact app build.

### 1.5 Chevron / arrow motif and animation

Older iterations of the Android incoming-call and unlock-swipe affordances used a chevron
(">>>" or "^^^") hint animation cascading toward the swipe direction, similar to the old
"swipe to unlock" arrows. The current (2025 redesign) horizontal-swipe pill replaces
chevrons with the ringing-icon wiggle + red/green text color-cycle described in §1.1c;
treat literal chevron arrows as **legacy** (pre-2024 AOSP) rather than current — **[MED]**,
based on absence of chevron mention in any 2025 teardown coverage.

---

## 2. In-call screen

### 2.1 Evolution

- **2023 redesign** [HIGH, 9to5Google/Android Headlines]: introduced a **bottom-sheet** control
  layout. Primary row directly above the end-call button: **Keypad, Mute, Speaker/Bluetooth,
  More** (4 buttons, left to right). Tapping **More** slides up a sheet exposing **Hold, Video
  call, Add call**, and secondary options (Record, etc.). This moved controls toward the bottom
  of the screen for one-handed reachability — explicit design goal per that rollout.
- **2025 Material 3 Expressive redesign** [HIGH, Android Authority/9to5Google/Android Police]:
  - Buttons "mostly eliminate simple circular buttons" in favor of **larger, oval/pill-shaped
    buttons that morph into rounded rectangles when pressed/selected** — an explicit
    press-state shape-morph animation, characteristic M3 Expressive behavior (shape as a
    stateful, animated property, not just a static token).
  - **End-call button**: enlarged, moved to sit right at the bottom edge, described as "much
    larger and pill-shaped" / "giant" — this is the clearest confirmed instance of M3
    Expressive's shift from circular FAB-style end-call buttons to a wide stadium/pill shape.
    Treat "pill / stadium shape, full-width-ish, anchored to bottom edge" as **[HIGH]**; exact
    dp width/height **[LOW]** (not published — reconstruct from screenshots, expect roughly
    64–72dp tall, 30–45% of screen width, corner radius = height/2 i.e. fully rounded stadium).
  - Contact photo during the call rendered inside an "animated, squiggly circle shape" per
    Android Police — likely one of M3 Expressive's ~35 shape-morph library shapes (scallops/
    squircles). **[LOW]** on exact shape; **[HIGH]** that some non-circular animated container
    is used.
  - Answer button (on the incoming screen, carried conceptually into the in-call transition)
    "retains its circular icon" even as end-call goes pill-shaped — so accept ≠ decline in
    final shape language; decline/end-call is the pill, answer/accept keeps a circular icon
    treatment. **[MED]**.

### 2.2 Recommended layout for the replica

- Top: caller name (large, centered or left-aligned depending on target device size),
  call state text ("Calling…", or the running timer once connected).
- **Timer**: `MM:SS` while under an hour, `H:MM:SS` past 60 minutes — standard Android/Compose
  `Chronometer` format. **[HIGH]** on format (this is a documented `android.widget.Chronometer`
  behavior: default pattern is `MM:SS`, expands to include hours once elapsed ≥ 3600s).
  Typography: likely `titleMedium`/`bodyLarge` scale, monospaced tabular figures are NOT
  guaranteed — Android's default Chronometer uses the theme's normal (proportional) digit
  font, not a monospace face. **[MED]**.
- Middle: contact photo in its (possibly shape-morphing) container.
- Bottom control cluster: 4-up primary row — **Mute, Keypad, Speaker, More(⋮)** — pill buttons
  in a `surfaceContainerHigh`/`surfaceContainerHighest` (dark theme) fill when unselected,
  filled `primaryContainer`/`secondaryContainer` tonal color when toggled active (e.g., Mute
  ON), morphing to a more rounded-rectangle shape on press per §2.1. "More" expands a
  bottom-sheet or inline row with **Hold, Add call, Video call** (and Record/Swap where carrier-
  supported).
- Very bottom, isolated from the 4-up row: the **red pill-shaped End Call button**, full or
  near-full width, anchored to the bottom safe-area edge.

### 2.3 Shapes/geometry token mapping [MED]

- Standard (unselected) in-call buttons: circular-to-pill hybrid; use M3 shape token
  `corner.large` (16dp) at rest, animating toward `corner.full` (stadium, effectively
  height/2 radius, i.e. `9999dp`/50%) on press — this "shape morph on interaction" is the
  literal M3 Expressive shape-system feature (~35 shapes with built-in morph animation).
  **[MED]** — general M3 Expressive shape behavior is HIGH confidence; that it's specifically
  `corner.large → corner.full` for *this* button is a reasonable but unconfirmed mapping.
- End-call button: `corner.full` (stadium/pill) at all times, per the "pill-shaped" description.

---

## 3. Material 3 design tokens (baseline dark theme)

These are the **M3 baseline palette** (the default "Material You" seed before any dynamic
wallpaper-color extraction) — same literals shipped in
`androidx.compose.material3.tokens.ColorDarkTokens` / `Palette*Tokens.kt`, stable since the M3
color-roles spec (2021) and the surface-container-roles addendum (2023). **[MED-HIGH]** —
recalled from training knowledge, not re-scraped live this session (m3.material.io is a JS SPA
that WebFetch could not render); cross-check against `m3.material.io/styles/color/roles` or the
AndroidX source before treating as final.

| Role | Dark theme hex |
|---|---|
| `primary` | `#D0BCFF` |
| `onPrimary` | `#381E72` |
| `primaryContainer` | `#4F378B` |
| `onPrimaryContainer` | `#EADDFF` |
| `secondary` | `#CCC2DC` |
| `secondaryContainer` | `#4A4458` |
| `tertiary` | `#EFB8C8` |
| `error` | `#F2B8B5` |
| `onError` | `#601410` |
| `errorContainer` | `#8C1D18` |
| `onErrorContainer` | `#F9DEDC` |
| `background` / `surface` | `#1C1B1F` |
| `onSurface` / `onBackground` | `#E6E1E5` |
| `surfaceVariant` | `#49454F` |
| `onSurfaceVariant` | `#CAC4D0` |
| `outline` | `#938F99` |
| `surfaceDim` | `#1C1B1F` |
| `surfaceBright` | `#3B383E` |
| `surfaceContainerLowest` | `#0F0D13` |
| `surfaceContainerLow` | `#1D1B20` |
| `surfaceContainer` | `#211F26` |
| `surfaceContainerHigh` | `#2B2930` |
| `surfaceContainerHighest` | `#36343B` |

**For this replica, practical picks:**
- Page/screen background (in-call + incoming): `surface` `#1C1B1F` or `surfaceContainerLowest`
  `#0F0D13` for extra depth behind a photo.
- Unselected button chip fill: `surfaceContainerHigh` `#2B2930`.
- Selected/toggled button fill: `primaryContainer` `#4F378B` with `onPrimaryContainer`
  `#EADDFF` icon/label.
- Decline / end-call button: `error`/`errorContainer` family (`#F2B8B5` fill + `#601410` icon,
  or the deeper `#8C1D18` for the container) — or, since real screenshots read as a punchier
  saturated red than the muted M3 `error` tonal role, a brand red like `#EA4335`/`#D93025` is a
  defensible visual stand-in. **[LOW]** on which of these two the real app actually uses —
  recommend building with a CSS variable so it's swappable.
- Accept/answer: green — no confirmed M3 role is used for this (M3 has no default "success"
  role); use a custom green consistent with Google's brand green `#34A853`/`#1E8E3E`, or a
  generated M3 tertiary-tonal green if you want strict token discipline. **[LOW]**.

### 3.1 Type scale (M3 baseline) [MED-HIGH]

| Token | Size / line-height (sp) | Weight | Tracking |
|---|---|---|---|
| displayLarge | 57/64 | 400 | -0.25 |
| displayMedium | 45/52 | 400 | 0 |
| displaySmall | 36/44 | 400 | 0 |
| headlineLarge | 32/40 | 400 | 0 |
| headlineMedium | 28/36 | 400 | 0 |
| headlineSmall | 24/32 | 400 | 0 |
| titleLarge | 22/28 | 400 | 0 |
| titleMedium | 16/24 | 500 | 0.15 |
| titleSmall | 14/20 | 500 | 0.1 |
| bodyLarge | 16/24 | 400 | 0.5 |
| bodyMedium | 14/20 | 400 | 0.25 |
| bodySmall | 12/16 | 400 | 0.4 |
| labelLarge | 14/20 | 500 | 0.1 |
| labelMedium | 12/16 | 500 | 0.5 |
| labelSmall | 11/16 | 500 | 0.5 |

**For this screen**, map: caller name → `headlineLarge`/`displaySmall` (32–36sp, given
"much larger" per the redesign coverage — consider even `displayMedium` 45sp for the name if
you want to match "much larger contact names"); subtitle/number → `bodyLarge`/`titleMedium`;
timer → `titleLarge`/`headlineSmall`; button labels → `labelLarge`.

### 3.2 Shape scale [MED]

M3 corner-radius tokens: `extra-small` 4dp, `small` 8dp, `medium` 12dp, `large` 16dp,
`extra-large` 28dp, `full` = 50% / effectively unlimited (stadium/pill). The `extra-large` 28dp
value is documented as used for expanded bottom sheets; `full` is used for badges, pills, FABs.

---

## 4. Differences from iOS that matter to a replica

- **Elevation vs. blur**: Material historically signals hierarchy with *elevation* (tonal
  surface color shifts + soft drop shadows) rather than iOS's frosted-glass blur. M3
  `surfaceContainer*` roles are Google's answer to "how do I show this sheet is above that
  surface" — implement with solid tonal fills, not `backdrop-filter: blur()`. (Material 3
  Expressive does add background blur effects in some contexts per Android 16 QPR coverage, so
  a light blur on the incoming-call background is not wrong, just secondary to tonal elevation.)
- **Corner-radius language**: iOS call screens use continuous corner buttons (~moderate radius,
  fixed). M3 Expressive's shape system is *stateful and animated* — shapes morph between states
  (e.g., button at rest vs. pressed), and the shape vocabulary includes ~35 named shapes beyond
  simple rounded rects (squircles, scallops, bursts). A faithful replica should animate
  border-radius / clip-path on press, not just pick one static radius.
- **Motion**: Historically Material used fixed-duration easing curves. **M3 Expressive replaces
  duration/easing curves with a spring-physics motion system** (stiffness/damping/initial
  velocity parameters, with "expressive" and "standard" preset schemes) for its own components.
  For the *pre-Expressive* baseline M3 motion tokens (still valid to reference / good CSS
  fallback since spring physics is hard to express in CSS transitions):
  - Duration tokens (ms): `short1` 50, `short2` 100, `short3` 150, `short4` 200, `medium1` 250,
    `medium2` 300, `medium3` 350, `medium4` 400, `long1` 450, `long2` 500, `long3` 550,
    `long4` 600, `extraLong1` 700, `extraLong2` 800, `extraLong3` 900, `extraLong4` 1000.
    **[MED]** — standard published M3 values, not re-verified this session.
  - Easing (cubic-bezier): `standard` `cubic-bezier(0.2, 0.0, 0, 1.0)`,
    `standard-decelerate` `cubic-bezier(0, 0, 0, 1)`,
    `standard-accelerate` `cubic-bezier(0.3, 0, 1, 1)`,
    `emphasized-decelerate` `cubic-bezier(0.05, 0.7, 0.1, 1.0)` (this one corroborated live via
    search this session — **[HIGH]**),
    `emphasized-accelerate` `cubic-bezier(0.3, 0.0, 0.8, 0.15)` **[MED]**.
    Note: true M3 "emphasized" easing is technically a two-segment path interpolator, not a
    single cubic-bezier — the values above are the standard *approximation* used for CSS/other
    single-curve systems, which is what you want for a web replica anyway.
  - For CSS, since real spring easing isn't natively expressible, use
    `cubic-bezier(0.05, 0.7, 0.1, 1.0)` (emphasized-decelerate) for entrance/expand animations
    (button press → pill morph, sheet reveal) and `standard` for simple fades — this reads as
    "Android-ish bounce" without needing a JS spring library. If you want literal spring
    physics, implement with a small spring interpolation function (Framer Motion / CSS
    `linear()` easing function approximating a spring) rather than `transition-timing-function`.
- **Haptics**: Android call UI uses `HapticFeedbackConstants` (e.g. a firm click on
  answer/decline, distinct from iOS's Taptic Engine curves). Not replicable in a browser beyond
  the Vibration API (`navigator.vibrate()`), which is unsupported on iOS Safari and has no iOS
  parity — treat as an Android-only nice-to-have, not a cross-platform requirement.
- **Status bar green pill during a call**: Android shows a persistent status-bar "chip"
  (pill-shaped) during an ongoing call showing a phone icon + elapsed `MM:SS` timer, present
  since Android 12 (previously called a "bubble," renamed "chip" in the Android 12 betas). In
  Android 16, this generalizes into the **"Live Updates"** system — a pill on the status bar
  (top area) that's tappable to jump back into the call notification. Distinct from the separate
  **green dot** privacy indicator (camera/mic access, top-right, since Android 12) — don't
  conflate the two; a phone call itself does not trigger the green *dot*, only the call *chip*.
  **[HIGH]** on both existing as separate, real, shipped features.
- **No unified "Dynamic Island" analog**: iOS 16+ Dynamic Island is a hardware-cutout-anchored
  persistent bubble; Android's status-bar chip/Live Update pill is a software-only status-bar
  element with no camera-cutout integration — visually simpler, just a pill in the status bar
  row, not a screen-top blob that expands over the notch.

---

## 5. Fonts

- **Google Sans**: As of **Dec 10, 2025**, Google released Google Sans under the **SIL Open
  Font License** — the first time its primary brand font family became publicly usable
  [Creative Bloq]. It is also listed on **Google Fonts** (fonts.google.com/specimen/Google+Sans)
  — **[HIGH]**, confirmed live this session. Note the Google Phone app itself may still be using
  the older, size-optimized "Google Sans Text"/"Google Sans Display" variants used across
  Android system UI (these are the actual system font in Pixel's Android build, "Google Sans"
  proper is the marketing/brand name — treat as effectively the same family for a replica).
  Before this Dec 2025 license change, Google Sans/Product Sans was under Google's own
  restricted license and not legally embeddable outside Google properties — **now it is safe to
  self-host or pull from Google Fonts for this project**.
- **Roboto**: Android's system body font, fully open (Apache 2.0) and on Google Fonts
  (`fonts.google.com/specimen/Roboto`) — no licensing concern, **[HIGH]**.
- **Recommended CSS stack**:
  `font-family: "Google Sans", "Google Sans Text", Roboto, "Segoe UI", system-ui, sans-serif;`
  — Google Sans (now open) for the caller-name / headline-scale text to nail the branded look,
  Roboto for body/label-scale UI chrome (buttons, timer, secondary text), matching real Android
  system-UI convention of Google Sans for prominent/display text + Roboto for everything else.
  Load both via `<link>` to Google Fonts or self-hosted `@font-face` (now permitted).

---

## 6. Sounds / ringtone

- Android ships several built-in default ringtones (varies by OEM/version; Pixel's stock set
  includes tones like "Orbit," and system alert tones live in
  `/system/media/audio/ringtones/`). **These are Google-owned/bundled audio assets, not
  freely redistributable** — a replica must NOT bundle an actual Pixel/Android system ringtone
  file. **[HIGH]** on the licensing risk; exact current default ringtone name **[LOW]** (varies
  by Android version/carrier and wasn't independently confirmed this session).
- **Recommended replacement**: pull a royalty-free "phone ring" / "old telephone bell" or
  "modern digital ringtone" SFX from a permissive-license library — **Pixabay** (sound effects,
  explicitly no attribution required for commercial use), **Mixkit** (free license, no
  attribution required), or **Freesound.org** (filter to CC0). Avoid Zedge-sourced tones (those
  are frequently third-party uploads of copyrighted ringtones, not cleared for redistribution).
  Pick something short (2–4s loop segment), synthesized/digital-sounding rather than a real
  musical excerpt, to stay unambiguously clear of any rights issues and to read as
  "generic smartphone," not a specific brand's proprietary tone.

---

## Confidence key

- **[HIGH]** — corroborated by a live source fetched/searched this session (news teardown,
  official doc excerpt, or a fact directly confirmed by search results).
- **[MED]** — standard, long-stable public spec (M3 tokens) recalled from training knowledge;
  very likely correct and widely mirrored in AndroidX source, but not re-scraped live this
  session because m3.material.io did not render via WebFetch.
- **[LOW]** — reconstructed/inferred (e.g., exact px/dp sizes not published anywhere,
  conflicting descriptions across outlets, or genuinely unconfirmed detail). Treat as a
  reasonable placeholder to implement, not a verified fact — flag for visual comparison against
  real screenshots/device video before treating as final.

## Sources

- [Google Phone's incoming call screen could get a facelift you can choose (APK teardown) — Android Authority](https://www.androidauthority.com/google-phone-incoming-call-ui-choice-apk-teardown-3562662/)
- [Google is changing how you answer calls with a major Phone app redesign — Android Police](https://www.androidpolice.com/google-change-answer-call-screen-major-phone-redesign/)
- [Google Phone App Gets Material 3 Redesign with Swipe-to-Answer Feature — Republic World](https://www.republicworld.com/tech/google-phone-app-gets-material-3-redesign-with-swipe-to-answer-feature-to-prevent-pocket-calls-heres-how-to-revert-it)
- [Google's Phone app just got a major redesign — Android Police](https://www.androidpolice.com/google-phone-app-material-3-expressive-update-rolling-out/)
- [The Google Phone App Is Getting Two New Features You'll Love — How-To Geek](https://www.howtogeek.com/the-google-phone-app-is-getting-two-new-features-youll-love/)
- [Google Phone app rolls out big Material 3 Expressive redesign — 9to5Google](https://9to5google.com/2025/08/21/google-phone-material-3-expressive-redesign/)
- [Google Phone app rolling out Material 3 Expressive redesign — 9to5Google (June 2025)](https://9to5google.com/2025/06/19/google-phone-material-3-expressive/)
- [Google's default Phone app gets a redesign overhaul with Android 16 — GSMArena](https://m.gsmarena.com/newscomm-68390p2.php)
- [First look: Google's Phone app is getting a tasty Android 16 redesign (APK teardown) — Android Authority](https://www.androidauthority.com/phone-by-google-material-3-expressive-teardown-3562641/)
- [Google Phone app rolling out new calling screen with bottom sheet redesign — 9to5Google](https://9to5google.com/2023/03/01/google-phone-calling-screen/)
- [Google rolls out calling screen redesign for its Phone app — Android Headlines](https://www.androidheadlines.com/2023/03/google-rolls-out-calling-screen-redesign-for-phone-app.html)
- [Android 12 starts showing 'Ongoing call' chip for Google Phone app in the status bar — 9to5Google](https://9to5google.com/2021/08/09/android-12-google-phone-ongoing-call-chip/)
- [Android 12 Beta replaces ongoing call "bubble" with "chip" — GSMArena](https://m.gsmarena.com/android_12_beta_replaces_ongoing_call_bubble_with_chip-news-50513.php)
- [Google rolling out Android 16 QPR1 with Material 3 Expressive redesign for Pixel — 9to5Google](https://9to5google.com/2025/09/03/android-16-qpr1-pixel/)
- [Android Live Updates (Material You) — newly.app](https://newly.app/guides/android-live-updates-material-you)
- [Google Phone stealing One UI, iOS call answer buttons — Sammy Fans](https://www.sammyfans.com/2024/09/30/google-phone-stealing-one-ui-ios-call-answer-buttons/)
- [Samsung's next calling trick looks straight out of Pixel playbook — Android Authority](https://www.androidauthority.com/one-ui-8-5-automatic-call-screening-more-control-apk-teardown-3604709/)
- [Google's iconic brand font is now free for anyone to use — Creative Bloq](https://www.creativebloq.com/design/fonts-typography/googles-iconic-brand-font-is-now-free-for-anyone-to-use)
- [Google Sans — Google Fonts](https://fonts.google.com/specimen/Google%2BSans)
- [Product Sans — Wikipedia](https://en.wikipedia.org/wiki/Product_Sans)
- [Material 3 Expressive: New Components, Motion, Shapes, and More — Supercharge Design](https://supercharge.design/blog/material-3-expressive)
- [Compose Material 3 Expressive — Medium (ZoeWave)](https://zoewave.medium.com/compose-material-3-expressive-89f4147df5b8)
- [Easing and duration – Material Design 3 (page ref, JS-rendered, not scraped directly)](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
- [Color roles – Material Design 3 (page ref, JS-rendered, not scraped directly)](https://m3.material.io/styles/color/roles)
- [Shape – Material Design 3 corner-radius-scale (page ref)](https://m3.material.io/styles/shape/corner-radius-scale)
- [Download Free Ringing Tones and Call Tones — Pixabay](https://pixabay.com/sound-effects/search/ring-tone/)
- [Download Free Phone Ring Sound Effects — Mixkit](https://mixkit.co/free-sound-effects/phone-ring/)
