# iOS Phone Call UI — Pixel-Level Replication Spec

Scope: iOS 17/18/26-era native Phone-app call screens (CallKit system UI), for building an HTML/CSS "fake call" personal-safety web app. No carrier-spoofing or caller-ID-impersonation content included.

Legend for confidence tags:
- **HIGH** — directly stated in an Apple doc, a widely corroborated technical reference (e.g. system-color hex dumps used across thousands of apps), or trivially-verifiable first-hand iOS behavior.
- **MED** — corroborated by multiple secondary sources (blogs, teardown threads, Figma kit descriptions) but not an Apple primary source.
- **LOW** — inferred/estimated from indirect evidence, general iOS HIG scale conventions, or single-source claims; treat as a starting point to eyeball-correct against a real device screenshot.

---

## 1. Incoming Call Screen

### 1.1 Overall structure (iOS 17+)
Apple restructured the incoming-call screen in iOS 17 alongside the **Contact Posters** feature. Key structural facts (MED, corroborated across Macworld/Tom's Guide/idownloadblog/MacRumors threads):

- The screen is **full-bleed**: contact photo/poster or a **solid gradient fill** fills the entire screen behind the status bar and Dynamic Island. Before iOS 17, the background was the user's *blurred home-screen wallpaper*; iOS 17+ replaced that with a flat/gradient background tied to the Contact Poster (or a neutral system gradient when there's no poster). (MED)
- All action buttons were consolidated to the **bottom** of the screen (previously center-screen). (HIGH — corroborated by Macworld, TechRadar, Gizmodo, TechCrunch coverage of the iOS 17 betas, where Apple tried moving End Call to bottom-right and reverted to bottom-center after user backlash)
- On the **incoming-call** screen specifically, the secondary-action row (previously "Remind Me" / "Message") is now **Message (left)** and (since Live Voicemail shipped) effectively a **decline-to-voicemail** affordance; "Remind Me" was removed. (MED — MacRumors forum thread + idownloadblog)

### 1.2 Background — with a contact photo / Contact Poster
- Full-screen image (contact's Poster or Photo), typically with a **dark gradient overlay** near the bottom third to keep the white text/buttons legible over bright photos — a standard "scrim" technique (a `rgba(0,0,0,0)→rgba(0,0,0,0.55)` linear gradient from ~55% down to 100% of screen height is a reasonable recreation). (LOW — inferred from standard iOS legibility patterns, not a documented exact gradient)
- Poster customization (for reference, if you want to expose similar options in your fake-call composer): Camera / Photos / Memoji / **Monogram**, each with adjustable background color and typeface. (HIGH — Apple's own Contact Poster feature description, corroborated by gadgethacks/idownloadblog)

### 1.3 Background — no photo (fallback / Monogram)
- iOS shows a **large centered monogram** (contact's initials) when there is no photo. (HIGH — behavior is longstanding since iOS 7-era Phone/Contacts and confirmed in current Contact Poster docs)
- Monogram typeface: **SF Compact Rounded** — this was the *first* Apple OS surface to use SF Compact Rounded at all (per Fonts In Use / typeface documentation). (MED)
- Fallback background when no custom poster color is chosen: a **dark, near-black gray gradient** — practically, recreate as a diagonal or vertical linear-gradient between two dark neutrals, e.g. `#3A3A3C → #1C1C1E` (these are exactly iOS's own `systemGray5`(dark)/`systemGray6`(dark)-family neutrals, which is a defensible, in-palette choice even though Apple hasn't published the literal call-screen fallback gradient stops). (LOW/estimated, but grounded in real system-gray tokens — see §3)
- Monogram circle: a filled circle (or here, full-bleed background tint) with 1–2 letter initials centered, typically **white/light initials on a mid-saturation flat color** chosen from a fixed system palette when the user picks Monogram in Contact Poster editor (blues, greens, oranges, pinks, purples, grays are among the picker swatches). (MED)

### 1.4 Caller name typography
- Font family: **SF Pro Display** (Apple's own system font; auto-switches from SF Pro Text to SF Pro Display at **≥20pt**). (HIGH — Apple's own SF Pro documentation / typography guide)
- Size: no Apple-published exact point size for this specific screen exists publicly, but it visually sits in the **Large Title (34pt)** to **Title 1 (28pt)** range of Apple's own HIG type scale, and is almost certainly **semibold or bold weight**, white/off-white color, centered horizontally. Best estimate: **~28–34pt, weight 600 (semibold)**. (LOW/estimated — grounded in Apple's official type-scale table but not a confirmed exact match for this specific system screen)
- Color: white (`#FFFFFF`) or near-white with a subtle text-shadow for legibility over photos — text shadow like `0 1px 3px rgba(0,0,0,0.35)` is a reasonable recreation. (LOW/estimated)
- Letter spacing: SF Pro Display's default (system) tracking — do **not** add manual letter-spacing; San Francisco is tuned for ~0 additional tracking at these sizes. (MED — general SF Pro design guidance)
- Vertical position: name sits in the **upper third** of the screen, below the status bar / Dynamic Island safe area, roughly starting around **safe-area-top + 80–110pt** on a Pro model (accounting for the ~59pt top safe-area inset on Dynamic-Island iPhones — see §3.4). (LOW/estimated)

### 1.5 Subtitle line ("mobile", "iPhone", "FaceTime Audio", "Ringing…")
- Positioned directly below the caller name, small caps-free plain text.
- Size: **~17pt (Body)** or **~15pt (Subhead)** — Apple's HIG scale gives Subhead = 15pt, Body = 17pt; the call subtitle visually reads closer to Subhead/Body weight `regular`. (LOW/estimated)
- Color/opacity: white at reduced opacity, typically **~70–80%** (`rgba(255,255,255,0.8)`), consistent with Apple's `secondaryLabel`-on-dark convention. (LOW/estimated, but pattern-consistent with system secondary-label usage)
- Content varies by call type: the device/label type synced from Contacts (`mobile`, `home`, `work`, `iPhone`), or `FaceTime Audio`/`FaceTime` for FaceTime calls, or transient states like `calling…`, `ringing…` on the *outgoing* call screen.

### 1.6 Action buttons — unlocked-phone incoming call (2-button "stacked pill" layout, iOS 17+)
This is the layout you want for a fake-call app (assumes the "phone" is unlocked/in-use, which is the standard 2-button — not slide-to-answer — presentation). (HIGH that this is the correct default: per SlashGear/UNILAD/iPhoneIslam coverage, iOS shows the red/green two-button UI whenever the phone is **already in use** — i.e., unlocked and actively being looked at — and only shows slide-to-answer when the phone is asleep/locked. A fake-call web app opened by the user is definitionally "in use," so the 2-button layout is the correct one to replicate.)

Layout (top to bottom, bottom-anchored, iOS 17+ redesign):
1. **Secondary-action row** (upper row, smaller pill/circle buttons): **Message** button on the left, a **Remind Me/Voicemail**-class button on the right (iOS 17 dropped "Remind Me" in favor of Live Voicemail's own affordance — for a fake-call app you can safely omit this row entirely, or keep just a decorative pair, since it carries no functional weight in the replica). (MED)
2. **Primary-action row** (lower row, large circles): **Decline (red)** on the left, **Accept (green)** on the right.

Button geometry (LOW/estimated — no Apple pixel spec is public; these are the standard, widely-replicated approximate values used in countless call-screen clones and Figma kits, and match the general iOS "large circular control" convention):
- Circle diameter: **~80–84pt** for the primary Accept/Decline circles (comfortably above Apple's 44pt minimum tap target); **~56–60pt** for the smaller secondary-row circles.
- Icon: white glyph, centered, **~28–32pt** icon size inside the primary circles (a phone-handset SF Symbol — `phone.fill` for the green accept, `phone.down.fill` for the red decline).
- Gap between the two primary circles: roughly **1/3 to 1/2 of the screen width** between centers — the pair is spread near the left/right thirds of the screen, not adjacent.
- Label text under each button (e.g. "Remind Me", "Message", "Decline", "Accept" are NOT always shown as text under the primary green/red circles in current iOS — the primary pair is icon-only; only the smaller secondary-row buttons get a text label underneath, ~11–12pt, white, centered). (LOW/estimated)
- Distance from bottom safe area: primary row sits roughly **40–60pt above the bottom safe-area inset** (which itself is 34pt on Face-ID iPhones). (LOW/estimated)

Colors for the two primary buttons — use the **exact iOS system colors** (§3):
- Accept (green): light-mode `#34C759`, dark-mode `#30D158` — call UI runs in dark-style chrome basically always, so **`#30D158` is the practical default** to use. (HIGH for the hex values themselves — they are Apple's documented `systemGreen`; MED for "which one the call screen literally renders," since Apple hasn't published a call-screen-specific swatch, and it's plausible the call UI uses a bespoke/fixed near-identical green rather than the dynamic system token)
- Decline (red): light-mode `#FF3B30`, dark-mode `#FF453A` → practical default **`#FF453A`**. (Same HIGH/MED split as above)

### 1.7 Slide-to-answer variant (locked-phone incoming call)
- Used only when the phone is **locked/asleep**. Full-screen photo/gradient background as above, but instead of two tap-targets, a horizontal **"slide to answer"** pill/track appears near the bottom, with a draggable circular **phone-handset knob** the user drags left→right to answer. A small red circular decline button sits separately (often reached by pressing the side button, or a soft "Decline" affordance appears if you touch the slide track without completing the drag). (HIGH — this is long-standing, well-documented iOS lock-screen call behavior, corroborated by the Apple Community threads and SlashGear/UNILAD explainer articles found in this research)
- **This is NOT the right default for a fake-call app.** Recommendation: implement the **2-button stacked layout** (§1.6) as the default and only mode, because (a) it's what real users overwhelmingly see day-to-day (phone in hand, unlocked), (b) it needs no drag-gesture engineering, and (c) it matches the context the fake-call app is actually used in (someone actively holding/looking at their unlocked phone when the "call" arrives). (Recommendation, not a research fact.)

---

## 2. In-Call / Active Call Screen

### 2.1 Layout overview
- Caller name centered near the top (same typographic treatment as incoming, though sometimes slightly smaller once the timer is visible below it).
- Call timer directly below the name, small, centered, monospaced-feeling but actually just SF Pro Text tabular figures.
- A **frosted/"glass" 3×2 (six-button) control grid** sits in the lower-middle area of the screen.
- The **red End Call button** sits below/separate from that grid, larger and by itself, at the very bottom.

### 2.2 Call timer format (HIGH confidence on the format rules themselves — this is standard, universally-observed iOS behavior; treat as HIGH despite no single citable doc, since it's trivially reproducible and consistent across all iOS versions):
- Starts at **`0:00`** the instant the call connects, counts up once per second.
- **Under 1 hour:** `M:SS` — i.e. minutes (no leading zero, so `0:07`, `1:23`, `9:45`) then colon then **2-digit zero-padded seconds**. So the very first second reads `0:01`, not `00:01`.
- **At/after 1 hour:** switches to `H:MM:SS` — hours (no leading zero) : 2-digit minutes : 2-digit seconds, e.g. `1:02:03`, `1:00:00` exactly at the 1-hour mark.
- Font: SF Pro (Text, since it's a small size), likely **~15–17pt**, `regular` weight, white, centered, tabular/monospaced-digit figure style so it doesn't jitter width as digits change (`font-variant-numeric: tabular-nums` in CSS is the correct web equivalent). (LOW/estimated on exact pt size; HIGH on tabular-nums necessity, since Apple's system font explicitly ships tabular figures for exactly this reason)

### 2.3 The 3×2 control grid
Confirmed **3-columns-by-2-rows** grid since the iOS 17 redesign (HIGH — Tom's Guide/Yahoo tech coverage explicitly describes "a 3 x 3 grid" including End Call as the 9th cell in some phrasing, but the **controls proper are a 3×2 grid of 6 toggle-style buttons**, with End Call rendered as a separate, larger, non-grid element below/beside it — cross-checked against AT&T's official in-call support doc and Apple's own "While on a call" support guide).

Standard six controls (per Apple's official "While on a call" support article, cross-referenced against the grid-repositioning coverage):
1. **mute** (`mic.slash.fill` toggled / `mic.fill` idle)
2. **keypad** (`circle.grid.3x3.fill` / dial-pad glyph) — opens the DTMF keypad overlay
3. **audio / speaker** (`speaker.wave.2.fill`) — opens an audio-route picker (Speaker / iPhone / Bluetooth device names)
4. **add call** (`person.badge.plus`)
5. **FaceTime** (`video.fill`) — upgrades the call to FaceTime Video
6. **contacts** (`person.crop.circle.fill`) — jumps to the caller's contact card (note: some post-iOS17 builds have reportedly dropped/relocated this button per one Reddit-adjacent report found in search — treat as MED/possibly version-dependent)

Layout note (MED, from the button-repositioning coverage): in the iOS 17 shuffle, **audio and mute swapped positions**, and **keypad moved down** to sit between End and Add-call in the visual flow. For a *replica* app, exact cell assignment matters less than getting the **look** (glass circles, correct icon set, correct toggle-state styling) right — recommend a straightforward mute / keypad / speaker top row, add-call / FaceTime / contacts bottom row, which matches the commonly-cited pre-and-post arrangement closely enough for a convincing fake.

Button geometry (LOW/estimated — consistent with typical iOS "glass button" system controls sized above the 44pt minimum):
- Each circle: **~70–76pt diameter**, arranged in a 3-column grid with roughly **16–24pt** gutters between cells, centered as a block in the lower-middle of the screen.
- Icon: white/light glyph, ~**24–28pt**, centered in the circle.
- **Idle (off) state:** translucent frosted-glass fill — recreate as `background: rgba(255,255,255,0.16)` (or `0.12–0.20`) plus `backdrop-filter: blur(20px)` to approximate SwiftUI's `.ultraThinMaterial` over a dark backdrop. Icon color white.
- **Active/toggled (on) state** (e.g. Mute engaged, Speaker engaged): fill **inverts to solid white** (`#FFFFFF` or near, `~0.9` opacity), and the icon becomes **dark/black** (`#000000` or near) — the classic iOS "selected pill" inversion pattern used throughout system UI (keyboard shift key, control-center toggles, etc.). (MED — this on/off inversion convention is extremely consistent across iOS system chrome, though not documented with an exact alpha value for this specific screen)

### 2.4 End Call button
- A separate, large **red filled circle**, positioned below/apart from the 3×2 grid (bottom-center or bottom-right depending on iOS 17 beta vs. shipped version — Apple **reverted** the bottom-right experiment back to **bottom-center** before shipping iOS 17 GA, per TechCrunch's "Apple reverses decision" coverage). Use **bottom-center** as the safe default. (HIGH on bottom-center being the shipped/current position; the bottom-right variant was beta-only and reverted)
- Diameter: noticeably larger than the grid buttons — **~78–84pt** is a reasonable match, roughly matching or slightly exceeding the primary incoming-call Accept/Decline circle size. (LOW/estimated)
- Color: solid red, same system-red family as decline — `#FF453A` (dark-chrome default) / `#FF3B30` (light). (HIGH for the hex values; MED for exact call-screen usage, same caveat as §1.6)
- Icon: a phone-handset glyph (`phone.down.fill`) **rotated 135°** from the "answer" handset orientation — this rotation is the classic visual differentiator between "answer" (handset pointing up-right, receiver-to-ear angle) and "decline/hang up" (handset rotated to a downward-crossed angle suggesting hanging up) that Apple has used since iOS 7. (MED — well-known/widely-replicated visual convention; exact "135°" figure is the commonly-cited approximation in UI teardown discussions rather than an Apple-published number)

### 2.5 In-call background
- Dark, blurred gradient — pre-iOS 17 this was the phone's home-screen wallpaper blurred; iOS 17+ moved to a **flat/gradient dark fill** in the same spirit as the incoming-call redesign (some users specifically report the new default reads as **flat gray** rather than a rich gradient, per Apple Community/MacObserver threads about "iOS 17 gray call screen"). (MED)
- Practical recreation: a dark vertical or radial gradient between two near-black neutrals, e.g. `#1C1C1E → #000000` or `#2C2C2E → #0A0A0C`, optionally with the contact photo blurred heavily (`blur(60–90px)`, darkened ~50%) behind it for the photo-available case, falling back to the flat dark gradient when there's no photo. (LOW/estimated, grounded in system-gray dark tokens)

### 2.6 Status bar / Dynamic Island during a call
- The **status bar is generally hidden/absent** on the full-screen call UI itself (it's a full-screen system overlay), but once you **navigate away** from the call screen (e.g. back to Home Screen) while a call is active:
  - On non-Dynamic-Island devices: a **green (or occasionally red/blue for other live activities) pill/bar** appears at the top showing "Tap to return to call" with the timer.
  - On **Dynamic-Island** devices (iPhone 14 Pro and later): the call becomes a **Live Activity in the Dynamic Island** — shown as the compact pill (green, with a small icon and running timer) that can be tapped to return to the full call UI, or long-pressed for an expanded view. (HIGH — Dynamic Island Live Activity behavior for phone calls is standard, widely documented iOS behavior)
- Dynamic Island compact-pill dimensions (from research): **~126×37pt** for the pill states generally cited in Dynamic-Island teardown pieces (exact width varies with content); the **island hardware cutout itself** measures **~52×37pt** (14 Pro) / **~62×37pt** (14 Pro Max) — i.e., the *pill you draw around a Live Activity* is wider than the physical cutout because it needs room for the leading/trailing content. (MED — from UX Planet's Dynamic Island guide and useyourloaf.com's iPhone screen-size references)
- For a **web-based fake-call app**, you do not have OS-level access to draw into the real Dynamic Island — recommend simply **not attempting to fake the Dynamic Island interaction** (i.e., don't claim the "return to call" pill works) and focus entirely on the full-screen call UI, which is what a user will actually be looking at.

---

## 3. Colors & Materials — canonical reference table

All values below are Apple's own **documented dynamic system colors** (HIGH confidence on the hex values themselves, cross-verified across swiftuicolors.com and the CreatureSurvive community reference gist, which are independently and consistently cited across thousands of iOS dev resources). Where they're used *specifically on the call screen* is MED/LOW as noted in §1–2, since Apple has not published a literal call-screen design spec.

| Token | Light hex | Dark hex | Call-UI usage |
|---|---|---|---|
| `systemGreen` | `#34C759` | `#30D158` | Accept / answer button |
| `systemRed` | `#FF3B30` | `#FF453A` | Decline / End Call button |
| `systemGray` | `#8E8E93` | `#8E8E93` | Secondary icon/text tints |
| `systemGray2` | `#AEAEB2` | `#636366` | — |
| `systemGray5` | `#E5E5EA` | `#2C2C2E` | Approximation for glass-button base / no-photo fallback |
| `systemGray6` | `#F2F2F7` | `#1C1C1E` | Approximation for dark call-screen background |
| `systemBackground` | `#FFFFFF` | `#000000` | — |
| `secondarySystemBackground` | `#F2F2F7` | `#1C1C1E` | — |
| `label` (primary text) | `#000000` | `#FFFFFF` | Caller name / timer |
| `secondaryLabel` | `#3C3C43` @ 60% | `#EBEBF5` @ 60% | Subtitle line |

**Materials:** the 3×2 control-grid buttons are almost certainly drawn with (or visually equivalent to) SwiftUI's **`.ultraThinMaterial`** / UIKit's `UIBlurEffect(style: .systemUltraThinMaterialDark)` — a frosted glass with heavy blur and low opacity over whatever's behind it. There is **no Apple-published exact alpha/blur value**; a defensible web recreation is:
```css
background: rgba(255, 255, 255, 0.16);
backdrop-filter: blur(20px) saturate(180%);
-webkit-backdrop-filter: blur(20px) saturate(180%);
```
(LOW/estimated on the specific numbers, MED on "ultraThinMaterial-class blur is the right family of effect to use.")

---

## 4. Motion

All of this section is **LOW confidence / best-practice recreation** — Apple does not publish exact easing curves or durations for this system-private UI, and no teardown source found gave frame-accurate timing. Use these as reasonable, professionally-defensible defaults:

- **Ring "pulse"**: many custom-ringtone/vibration docs found in this research describe **short-burst haptic patterns** (tap-based, user-composable in Settings → Sounds & Haptics → Create New Vibration) rather than a single fixed system cadence; the **classic default ring cadence** most people experience is bursts of the ringtone audio with the screen static (no strong pulsing animation on the incoming-call UI itself — the animation "pulse" people associate with phone calls is mostly the **screen brightness/wake** and **haptic buzz**, not a CSS-style pulsing glow). Recommend: don't over-animate the incoming screen; keep it mostly static aside from a subtle button press-down.
- **Button press scale**: standard iOS press feedback is a **quick scale-down to ~0.94–0.97** with opacity easing, spring-like release (`cubic-bezier(0.2, 0.8, 0.2, 1)` or a spring with ~300–400ms settle) — this is the general system-button press convention across iOS, not call-screen-specific documentation.
- **Incoming → in-call transition**: a **quick cross-fade / slight upward slide** (150–250ms) as the accept buttons disappear and the timer + 3×2 grid fade/slide in. A simple `opacity` + `translateY(12px→0)` over ~200ms with ease-out is a safe recreation.
- **Slide-to-answer knob**: a draggable circular handset icon inside a horizontal pill track; on release past ~70–80% of track width it **snaps to the end** and answers; released short of that, it **springs back** to the start with a bouncy spring animation. Track width spans nearly the full screen width minus margins; knob diameter roughly matches the track height (~56–64pt).

---

## 5. Fonts

- **True system font**: **SF Pro** (Text ≤19pt / Display ≥20pt), plus **SF Compact Rounded** for the no-photo monogram specifically. (HIGH for what Apple actually uses)
- **Web licensing**: **SF Pro / SF Compact are NOT licensed for general web `@font-face` embedding.** Apple's official position (per Apple's own Fonts page, `developer.apple.com/fonts/`) is that SF fonts are licensed for use in **software running on Apple platforms** (apps, and Apple-platform marketing material) — not for embedding on arbitrary websites or non-Apple apps. A public web app should **not** self-host SF Pro webfonts. (HIGH — this is Apple's stated licensing position)
- **Recommended web-safe fallback stack**, which is the standard, broadly-accepted way to get an "iOS-native" look in a browser without violating licensing:
  ```css
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
    "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
  ```
  - `-apple-system` / `BlinkMacSystemFont` make Safari/Chrome on macOS/iOS use the **real locally-installed San Francisco** automatically (no font file shipped, no licensing issue, and it's pixel-identical to native — this is the trick virtually every "looks like iOS" web project uses). Naming `"SF Pro Display"/"SF Pro Text"` explicitly is mostly redundant/inert on non-Apple platforms but harmless as a documented intent; `system-ui` is the modern generic fallback that resolves to San Francisco on Apple platforms and each OS's native UI font elsewhere (Segoe UI on Windows, Roboto on Android, etc.), which is the right *non-Apple-device* behavior for visitors on other platforms. (HIGH — `-apple-system`/`system-ui` behavior is well-documented, standard CSS practice)
- If pixel-perfect SF rendering off-device is required (e.g., generating a static export/screenshot rather than serving live to a browser that already has SF installed), the legitimate options are: (a) design in Sketch/Figma with Apple's official Design Resources kit (which includes SF under Apple's design-resource terms, for design/prototyping use), or (b) use Apple's **SF Symbols** app assets only for icons — but do not ship SF Pro `.otf`/`.ttf` font files inside a public web bundle.

---

## 6. Sounds

- **Default ringtone name**: **"Reflection"** has been the default iPhone ringtone since it replaced "Opening" as default around iOS 15/16, and remains the default through iOS 17 and (per the sources found) iOS 18. iOS 17 additionally added **20+ new ringtone options** (e.g. "Breaking", "Milky Way", "Valley", "Sprinkles") in the Settings sound picker, but "Reflection" stayed the **out-of-box default**. Older/legacy tones (including the classic "Opening"/"Marimba") persist under a "Classic" category. (MED — corroborated across Macworld, TomsGuide, native-ringtones.com, multiple Apple Community threads)
- **Vibration**: iPhone uses the **Taptic Engine** for calls; the default ring vibration is a repeating short-burst pattern synced to the ringtone, and users can record fully custom tap-based patterns in Settings → Sounds & Haptics → Ringtone → Vibration → Create New Vibration (tap-and-hold gestures on screen define long/short pulses). There is **no single official spec sheet** for the exact default pattern's timing published by Apple. (MED for the mechanism, LOW for exact timing numbers — none found)
- **Legally-safe replacement approach for a replica app** (recommendation, not a research citation): **do not** ship Apple's actual "Reflection" audio file or any ripped iOS ringtone — these are Apple copyrighted assets. Instead:
  1. License or commission an **original ringtone** that evokes the same *mood* (soft, airy, marimba/bell-like, ~100–120bpm pulsing melodic loop) without copying Reflection's actual melody/production.
  2. Or use a **royalty-free/CC0 ringtone-style track** from a stock library, explicitly not named or marketed as "the iPhone ringtone."
  3. For vibration, use the **Web Vibration API** (`navigator.vibrate([...])`, Android/Chrome-only — Safari/iOS does not expose vibration to web pages) with a generic repeating pulse pattern of your own devising — do not claim to replicate Apple's exact haptic pattern since it isn't publicly specified anyway.
  4. Clearly label the tone in any UI/settings as a "classic ringtone" or similar generic description rather than implying it's Apple's proprietary "Reflection."

---

## 7. Summary — the 3 things replicas most often get wrong

1. **Using the old pre-iOS-17 center-screen button layout.** Countless "fake call" generators and stock-asset mockups (surfaced repeatedly in this research on stock.adobe.com etc.) still show the pre-2023 centered green/red circle pair. Since iOS 17, both incoming and in-call screens push everything to the **bottom** of the screen, and the incoming screen has a **two-row stacked layout** (secondary row above, primary Accept/Decline row below), not a single centered row.
2. **Wrong background model.** Replicas often use a plain solid black or a photo with no scrim, when real iOS uses either (a) a full-bleed photo/poster **with a bottom-weighted dark gradient overlay** for legibility, or (b) for no-photo contacts, a **dark neutral gradient with a large centered monogram in SF Compact Rounded**, not a plain gray circle avatar like Android/most other apps use.
3. **Flat/solid button fills instead of frosted glass, and no on/off state distinction.** The in-call 3×2 grid buttons are translucent frosted "glass" (`ultraThinMaterial`-class blur) in their idle state and **invert to solid white with a dark icon** when toggled on (mute/speaker engaged) — a plain single-color circle (as most clones use) misses both the material look and this crucial state-change affordance that real users rely on to tell mute is active.

---

## Sources

- [Why do the "Reject" and "Accept" options appear in some iPhone calls but not in others? — iPhoneIslam](https://iphoneislam.com/en/2025/04/why-some-iphone-calls-have-a-decline-option-and-others-dont/155684) — MED, incoming-call unlocked-vs-locked UI behavior
- [Why Some iPhone Calls Have A Decline Option, And Others Don't — SlashGear](https://www.slashgear.com/1832274/iphone-calls-two-ways-decline-slide-to-answer-options-explained/) — MED
- [iPhone users left seriously 'dumbfounded'... — UNILADTech](https://www.uniladtech.com/apple/iphone/iphone-discover-reason-different-screens-answering-calls-035298-20251124) — MED
- [Red/Green Accept/Decline Buttons vs Slide — Apple Community](https://discussions.apple.com/thread/8625163) — MED
- [iOS 17 is making a big change to your call screen — Tom's Guide](https://www.tomsguide.com/news/ios-17-is-making-a-big-change-to-your-call-screen-what-you-need-to-know) — HIGH/MED, 3×2 grid + repositioning facts
- [Don't worry about the end-call button's new position — Macworld](https://www.macworld.com/article/2027705/ios-17-phone-app-end-call-button-moving.html) — HIGH, End Call bottom-center reversion
- [Apple reverses decision to change end call buttons placement in iOS 17 — TechCrunch](https://techcrunch.com/2023/08/16/apple-reverses-decision-to-change-end-call-buttons-placement-in-ios-17) — HIGH
- [Apple Is Moving the iPhone's End Call Button — Gizmodo](https://gizmodo.com/apple-iphone-move-end-call-ios-17-beta-1850721425) — MED
- [Incoming call screen removed Remind Me feature since iOS 17 — MacRumors Forums](https://forums.macrumors.com/threads/incoming-call-screen-removed-remind-me-feature-since-ios-17.2440626/) — MED
- [How is the iOS 17 update going to redesign the call screen? — Sparklin](https://sparklin.com/foresight/how-is-the-ios-17-update-going-to-redesign-the-call-screen) — MED
- [Set a Custom Contact Poster on Your iPhone — Gadget Hacks](https://ios.gadgethacks.com/how-to/set-custom-contact-poster-your-iphone-others-will-see-when-you-call-them-0385414/) — MED, Contact Poster options
- [How to add full-screen Contact Poster on iPhone in iOS 17 — idownloadblog](https://www.idownloadblog.com/2023/07/04/how-to-use-contact-poster-iphone/) — MED
- [swiftuicolors.com — iOS Colors](https://swiftuicolors.com/ios-colors) — HIGH, systemGreen/systemRed/systemGray hex values (light mode)
- [iOS System Colors with their light and dark values — CreatureSurvive gist](https://gist.github.com/CreatureSurvive/1788cd3d2587886ff70344e716c5af53) — HIGH, full light+dark hex table
- [Backwards compatibility for iOS 13 system colors — Noah Gilmore](https://noahgilmore.com/blog/dark-mode-uicolor-compatibility) — MED, dynamic-color background
- [Typography — Human Interface Guidelines — Apple Developer](https://developers.apple.com/design/human-interface-guidelines/foundations/typography/) — HIGH, official HIG type-scale reference
- [Apple Fonts — developer.apple.com/fonts](https://developer.apple.com/fonts/) — HIGH, SF Pro/SF Compact licensing + availability
- [System Font — Furkan Vijapura, Medium](https://medium.com/@furkan.vijapura/system-font-8152e560945d) — MED, SF Pro Text/Display size-switch threshold (19/20pt)
- [SF Compact Rounded Font — freefontdownload.org](https://www.freefontdownload.org/en/sf-compact-rounded.font) — LOW/MED
- [San Francisco Compact Rounded in use — Fonts In Use](https://fontsinuse.com/typefaces/78620/san-francisco-compact-rounded) — MED, monogram use of SF Compact Rounded
- [Apple Contacts app (macOS Sierra and iOS 10) — Fonts In Use](https://fontsinuse.com/uses/21184/apple-contacts-app-macos-sierra-and-ios-10) — MED
- [iPhone 14 Screen Sizes — useyourloaf.com](https://useyourloaf.com/blog/iphone-14-screen-sizes/) — HIGH, safe-area/status-bar geometry
- [Unlimited Guide to Dynamic Island — UX Planet](https://uxplanet.org/unlimited-guide-to-dynamic-island-48700ecc094f) — MED, Dynamic Island pill dimensions
- [iOS 17 gray call screen — Apple Community](https://discussions.apple.com/thread/255144443) — MED, background appearance change
- [How To Change Gray Call Screen on iOS 17 — MacObserver (title only, fetch blocked 403)](https://www.macobserver.com/tips/how-to/fix-ios-17-gray-call-screen/) — LOW, corroborates "gray" framing only
- [Background Blur and Gradients — iOS Design Handbook, Design+Code](https://designcode.io/ios-design-handbook-background-blur-and-gradients/) — LOW, general pattern reference
- [While on a call on iPhone — Apple Support (official)](https://support.apple.com/guide/iphone/while-on-a-call-iph3c9951d7/ios) — HIGH, official six in-call control list
- [Apple iPhone 13 Pro - In-Call Options — AT&T device support](https://www.att.com/device-support/article/wireless/KM1273407/Apple/iPhone13Pro) — MED, corroborates control list
- [iOS 17 just added over 20 new ringtones — Tom's Guide](https://tomsguide.com/news/ios-17-just-added-over-20-new-ringtones-to-your-iphone) — MED
- [Reflection - Ringtone Sound (Library, iOS 16, Apple) — native-ringtones.com](https://native-ringtones.com/ringtone/Reflection_Ringtone_Sound_Library_Ios_16_Apple/) — LOW/MED, corroborates "Reflection" naming
- [My ringtone 'minuet' changed to 'reflection' — Apple Community](https://discussions.apple.com/thread/255547071) — MED, corroborates Reflection as current default
- [Replace Ringtones With Custom Vibrations On An iPhone — MacMost](https://macmost.com/replace-ringtones-with-custom-vibrations-on-an-iphone.html) — MED, custom-vibration mechanism
- [Create Custom Vibrations for Contacts — Gadget Hacks](https://ios.gadgethacks.com/how-to/create-custom-vibrations-contacts-iphone/) — MED
- [Apple iOS 17 UI Kit — Figma Community](https://www.figma.com/community/file/1356014907735159935/apple-ios-17-ui-kit-free-ui-resources-upgraded-2024) — MED, existence of a comprehensive Apple-adjacent Figma reference (not directly fetchable/scraped — 403; consult manually for precise measurements if further precision is needed)
- [iOS Phone & FaceTime Call UI — Figma Community](https://www.figma.com/community/file/946897418129793949/ios-phone-facetime-call-ui) — LOW, existence only (fetch blocked, 403)
