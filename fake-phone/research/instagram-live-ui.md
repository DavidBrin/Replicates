# Instagram Live Broadcast UI — Replication Spec (2025/2026)

Compiled for building an HTML/CSS overlay on top of a live `getUserMedia` camera feed that
*looks like* an Instagram Live broadcast is in progress. Focus: the **broadcaster's own
screen** (what the phone's owner sees while going live), with viewer-screen differences noted
where they matter for the illusion.

Meta does not publish pixel specs for this screen, and there is no public, verified
pixel-accurate teardown of it. Every item below carries a **confidence marker**:

- **HIGH** — corroborated by a cited source (help doc, news article, or widely-repeated
  screenshot description) or is a stable, long-documented IG behavior.
- **MEDIUM** — consistent with sourced descriptions and general knowledge of the app, but no
  source gives exact pixel/hex values; treat as "very likely close, verify visually if a real
  screenshot becomes available."
- **LOW / INFERRED** — no direct source; reasoned from adjacent evidence, general mobile-live
  UI conventions (shared across IG/TikTok/YouTube/Twitch), or app-design defaults. Flagged
  explicitly so the engineer can choose to prioritize accuracy elsewhere.

Where a value is LOW confidence, a concrete "ship this" default is still given — the goal is a
usable spec, not a hedge-everything document.

---

## 0. TL;DR — what to build, and why

For "looks like a live stream is happening" to a **bystander glancing at the phone**, the
**broadcaster's own screen is what must be replicated** (it's what's physically on the screen),
but the elements that actually sell the illusion at a glance are borrowed from the *viewer*
experience layered onto the broadcaster chrome:

1. The **red "LIVE" pill + viewer-count pill** top-left — this is the single most
   recognizable "a stream is active" signal, and it's near-identical across IG/TikTok/YouTube/
   Twitch, so it reads as "live stream" even to someone who doesn't use Instagram specifically.
2. A **moving comment stream** with avatars + bold usernames rising and fading over the video —
   motion in the lower third is the second-strongest tell. A real broadcaster's own screen is
   often comment-sparse early in a stream; for the illusion, err toward *more* simulated comment
   activity than a real just-started IG Live would have.
3. **Floating hearts** bursting up from the bottom-right — instantly read as "people are
   reacting live," and nobody scrutinizes their exact color/path at a glance.

Bottom-bar icon fidelity (flip camera / effects / guest-request icons) matters least for the
glance test — invest there only after 1–3 are solid.

---

## 1. Top bar

### 1a. "LIVE" badge
- Position: top-left, below the status bar / notch safe area. **HIGH** (confirmed live badges
  render near the top of the broadcast screen; exact offset not documented).
- Shape: small rounded-rectangle pill, not a full pill (rectangle with modest corner radius,
  not a stadium/fully-round shape). **MEDIUM**.
- Color: solid red background. Public "Instagram red" most commonly cited for brand/live
  elements is **`#FD1D1D`**; a commonly-seen alternative in UI-kit teardowns is closer to
  **`#FF3040`/`#ED4956`** (IG's "notification/heart" red family). No single hex is officially
  documented for the Live badge specifically. **LOW-MEDIUM** — ship `#ED4956` or `#FF3040` (both
  read as "Instagram red" and are close to each other); avoid the pink/orange/purple *logo*
  gradient here, that's a different brand element (see §9).
- Corner radius: ~4–6px (subtle rounding, not a pill). **LOW, INFERRED** — matches IG's general
  small-badge convention (e.g., verified-style tags) rather than the fully-rounded pills used
  elsewhere in the app.
- Text: `LIVE`, uppercase, white, bold, small (~11–12sp), slight positive letter-spacing
  (~0.5–1px) typical of badge/label text. **LOW-MEDIUM, INFERRED**.
- Padding: tight, roughly 4px vertical / 8px horizontal. **LOW, INFERRED**.
- Sits immediately adjacent to (directly left of, touching or ~4px gap from) the viewer-count
  pill, effectively forming one combined capsule in the top-left corner. **MEDIUM**.

### 1b. Viewer-count pill
- Icon: an "eye" glyph (open-eye outline), immediately followed by the number. **HIGH** —
  confirmed by Instagram's own help content: "a small counter with an eye icon gives you the
  latest number of people watching," tappable for a fuller breakdown.
- Background: translucent dark/black pill (`rgba(0,0,0,0.35–0.5)`), white text — standard
  translucent-chip treatment used elsewhere in IG's camera UI. **MEDIUM, INFERRED**.
- Number formatting: Instagram's general convention is to show exact counts at low volumes and
  abbreviate at higher volumes (e.g., `1.2K`, `112K` instead of `112,454`). **HIGH** for the
  general abbreviation behavior; **LOW** for the exact crossover threshold during a live
  broadcast specifically (commonly assumed to switch to `K` formatting somewhere around
  1,000–10,000 viewers). For a replica: show the raw integer under 1,000, `X.XK` from 1,000
  up, `XXK` (no decimal) above ~10K, `X.XM` above 1M.
- Position: directly right of the LIVE badge, same row, same vertical alignment. **MEDIUM**.

### 1c. Close (✕) button
- Position: top-right corner, same row as the LIVE/viewer-count pills, opposite corner.
  **MEDIUM, INFERRED** (standard placement for camera/story/live dismiss controls throughout
  the app).
- Style: plain white "X" glyph, no background chip (unlike the LIVE/viewer pills), ~24px
  glyph, generous tap target (~44px). **LOW, INFERRED**.

### 1d. Broadcaster's own avatar/username
- On the **broadcaster's own screen**, IG does **not** prominently show the broadcaster's own
  avatar+username the way it shows the *host's* avatar+username on a **viewer's** screen (a
  viewer needs to be told whose stream it is; the broadcaster already knows). **LOW, INFERRED**
  — this is the most likely explanation for why sourced material only ever describes
  avatar+username as a *viewer-side* element. For the replica this doesn't matter: skip it on
  the broadcaster chrome, matching real behavior, and it also simplifies the build.
- Viewer-side only, for contrast: top-left shows the host's circular avatar (~32–36px, thin
  white ring), bold white username next to/below it, often with a small "Follow" pill button
  adjacent. **MEDIUM, INFERRED** from general IG Stories/Live viewer conventions.

---

## 2. Bottom bar

- Translucent dark scrim behind the whole row so white icons/text stay legible over bright
  video (`rgba(0,0,0,0.25–0.4)` gradient, see §5). **MEDIUM, INFERRED**.
- **Comment input**: pill-shaped, translucent (`rgba(255,255,255,0.15–0.2)` fill, or
  `rgba(0,0,0,0.3)` on some IG surfaces), occupies most of the row's width on the left, height
  ~36–40px, corner radius = full pill (height/2). Placeholder copy: **`Add a comment…`**
  (ellipsis character, sentence case, gray/white-70% text). **HIGH** on the copy and the general
  "comment bar at the bottom" placement — confirmed by Instagram's own help content describing
  the comment bar's location and its adjacent "⋯" turn-off-commenting control.
- **Icon row, right of the comment input** (left→right), best-available reconstruction:
  1. **`⋯` more/options** — opens a menu with at least "Turn off commenting." **HIGH** that this
     exists and sits near the comment bar; **LOW** on exact left-right ordering vs. the icons
     below.
  2. **Requests/guests smiley icon** — for viewer join-requests when guest features are active;
     shows a small red badge with a count when there are pending requests. **HIGH** that this
     icon and its red-badge-count behavior exist (sourced); **LOW** on exact resting position —
     it may only appear when guest requests are enabled/pending rather than always-on.
  3. **Person/add-guest icon** — invite a viewer to co-broadcast. **MEDIUM**.
  4. **Effects (face/wand) icon** — opens Stories-style filters/effects for the live camera.
     **HIGH** that this control exists; **LOW** on exact position in the row.
  5. **Flip-camera icon** (two curved arrows in a circle) — front/rear toggle. **HIGH** that
     this exists; **LOW** on exact position (right-most is the most commonly implied position).
- All icons are plain white glyphs, no chip background (contrast with the LIVE/viewer pills,
  which do have chip backgrounds). **LOW, INFERRED**.
- Row height: roughly 56–64px total bottom bar including safe-area padding. **LOW, INFERRED**.

**Replica recommendation**: since exact bottom-icon order/position is the least-verified part of
this spec and matters least for the glance-test, keep it simple — comment input pill + 3–4
plain white icons (⋯, effects, flip-camera) is enough; don't over-invest here.

---

## 3. Comment stream

- Rendering: each comment = small circular avatar (~24–28px) + **bold** white username + regular
  white message text, on one line (wrapping to a second line for long messages). **MEDIUM,
  INFERRED** from general IG Live/Stories comment-overlay convention, consistent with the "white
  text over video" pattern search results describe as the general design problem this UI has to
  solve.
- No solid message bubble/background per comment; legibility comes from the bottom gradient
  scrim (§5) plus a subtle text-shadow (`0 1px 2px rgba(0,0,0,0.5)` or similar) on the text
  itself. **LOW, INFERRED** — standard technique for white-text-over-video/photo per general
  scrim/overlay design practice.
- Position: lower-left, stacked bottom-up, directly above the bottom bar.
- Animation: new comment enters at the bottom (slight upward slide, ~20–30px travel, fade-in
  over ~200–300ms), pushes older comments upward; visible comment count is small (roughly 3–5
  at once in low-activity moments); older comments fade out (opacity → 0) after a few seconds
  or once several newer ones have appeared, rather than persisting indefinitely. **LOW,
  INFERRED** — no source gives exact timing; this is standard "toast stack" behavior consistent
  with how the surface avoids permanently obscuring the video.
- **System messages** (join notices): confirmed to exist — Instagram surfaces who's watching
  and viewer-join events in some form — but **no source gives the exact copy string**, and it is
  known to have changed wording across app versions. **LOW confidence on exact copy.** Ship one
  of these patterns (visually distinct from real comments: not bold, gray/70%-white instead of
  full white, no avatar or a smaller one):
  - `{username} joined this live video`
  - `{username} started watching`
  Pick one and be consistent; do not present this as a verified-exact string.

---

## 4. Hearts / likes animation

- Trigger: viewers tapping the video (in the viewer app) sends hearts; on the broadcaster's own
  screen these appear as incoming reactions. **HIGH** that this mechanic exists across
  IG/FB Live (well-documented "double-tap/tap-and-hold to send hearts" pattern); exact visual
  parameters are **LOW/INFERRED**.
- Visual: small heart-shaped particles, **multi-colored** (not single-color) — variety across
  a palette (red, pink, purple, yellow/orange, blue is typical for this genre of "flying hearts"
  live-stream overlay per stock-footage/motion-graphics packs modeling this exact effect).
  **MEDIUM** — corroborated by stock/motion-graphics listings describing IG-style live heart
  packs as multi-color with size/opacity variety, though these are third-party recreations, not
  Meta specs.
- Path: spawn near bottom-right (near the bottom bar / heart-trigger area), drift upward with a
  gentle side-to-side wobble (sine-wave horizontal drift), shrinking/fading near the top of
  travel. **LOW, INFERRED** — standard "flying hearts" implementation pattern used industry-wide
  (Facebook Live pioneered this exact effect; IG's is visually very similar).
  variable size (small to medium, roughly 16–32px), variable opacity, ~2–3s lifetime per heart.
  **LOW, INFERRED**.
- Frequency: scales with tap rate — single taps produce single hearts, sustained
  tap-and-hold/rapid tapping produces a denser stream. **MEDIUM, INFERRED** from how virtually
  every implementation of this genre of live-reaction UI behaves (including Instagram's own
  Stories/Reels heart-reaction pattern).

**Replica recommendation**: don't chase exact IG heart shapes/colors — a simple multi-color
heart-emoji-or-SVG rising with wobble + fade, randomized every few seconds plus on simulated
"engagement spikes," reads as correct at a glance and is the cheapest high-payoff element here.

---

## 5. Gradients / scrims over the video

- Top scrim: dark gradient overlaying roughly the top 120–150px of the screen, strongest near
  the very top and fading to transparent, to keep the LIVE badge/viewer pill/close-X legible
  over bright video. Suggested: `linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 100%)`
  over that band. **LOW, INFERRED** — not sourced to IG specifically, but matches the general
  "40% black → transparent" scrim convention search results describe as best practice for text
  legibility over dynamic video, and matches what's visually necessary given the white-on-video
  top bar.
- Bottom scrim: dark gradient over roughly the bottom 250–300px (covering the comment stream and
  bottom bar), strongest near the bottom edge. Suggested:
  `linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)`. **LOW, INFERRED**, same
  reasoning as above — this band needs more coverage than the top since it hosts more white text
  (comment stream + input placeholder + icons).
- Neither gradient should be a hard/visible band — keep it a smooth fade so it doesn't look like
  a static overlay; this matters more for "looks like a real broadcast" than any single color
  value.

---

## 6. Typography

- System font, not a custom webfont: **SF Pro on iOS, Roboto on Android** — confirmed by
  multiple sources as the interface font Instagram itself uses (Instagram Sans is a
  *marketing/brand* font used in logos and campaign material, not the live app chrome).
  **HIGH.**
- Web replica: use the system-font stack (`-apple-system, BlinkMacSystemFont, "Roboto",
  "Segoe UI", sans-serif`) rather than trying to license/embed Instagram Sans — this is both
  more accurate to the real broadcaster screen and avoids an unnecessary trademark-adjacent
  asset (see §9).
- Approximate sizes/weights (all **LOW/INFERRED**, no source gives exact type-scale values):
  - LIVE badge text: ~11–12sp, bold/700, uppercase, +0.5px tracking.
  - Viewer count: ~13sp, semibold/600.
  - Comment username: ~14sp, bold/700.
  - Comment message: ~14sp, regular/400.
  - Comment-bar placeholder ("Add a comment…"): ~15sp, regular/400, ~70% white opacity.
  - System join messages: ~13sp, regular/400, ~70% white opacity, not bold.

---

## 7. Viewer-count semantics

- Instagram's general large-number convention (confirmed, **HIGH**, applies app-wide not just to
  Live): round once past roughly 10,000 (e.g., `112K` instead of `112,454`); abbreviate with `K`
  for thousands and `M` for millions once the value crosses those thresholds, generally with one
  decimal place near the low end of a tier (`1.2K`) and no decimal once comfortably inside a tier
  (`112K`).
- Recommended replica rule: exact integer under 1,000 → `X.XK` from 1,000–99,999 → `XXXK` from
  100,000–999,999 → `X.XM` above 1,000,000.
- Copy around it: no label text next to the number beyond the eye icon itself (i.e., it does not
  say "123 watching" — just the icon + bare number). **LOW, INFERRED.**

---

## 8. Countdown, pre-live setup, and end screen

### 8a. Pre-live setup screen
- Shows a live self-view camera preview, a title input (placeholder along the lines of
  "Add a title…"), and an **audience selector** with at minimum `Public` and `Practice` options
  (Practice = visible only to you, doesn't notify anyone; useful for checking lighting/audio/
  angle before really going live). **HIGH** — confirmed via Instagram/Meta help content and
  multiple guide sources.
- A large "Go Live" pill button, plus filter/effects and flip-camera controls, consistent with
  the in-broadcast bottom bar. **MEDIUM, INFERRED.**

### 8b. Countdown (3-2-1)
- On tapping "Go Live," a 3-2-1 countdown displays before the broadcast actually starts publicly
  (giving the broadcaster a moment to prepare). **HIGH** — confirmed by multiple sourced guides
  describing this exact behavior.
- Visual treatment (size, whether it's in a circle, font) is **not documented** anywhere found;
  reasonable default: large bold white numeral (~72–96pt) centered on screen, optionally over a
  soft dark circular backdrop, consistent with Stories' own recording countdown pattern.
  **LOW, INFERRED.**

### 8c. "Live video ended" screen
- After ending, a summary screen appears showing **how many people watched**, plus a toggle/
  choice to **share the replay for 24 hours** so more people can watch it (vs. letting it
  disappear, though it's still saved to the broadcaster's private Live Archive either way).
  **HIGH** — confirmed via Instagram/Meta help content.
- Replays, once shared, retain the original comments and likes. **HIGH** — confirmed.
- Exact layout/copy of the buttons (e.g., "Share" vs "Discard," heading text) is **not
  documented** in available sources. **LOW, INFERRED** — reasonable defaults: heading like
  "Your live video ended," a viewer-count summary line, a primary "Share" button and a secondary
  "Discard"/"Delete" option.

---

## 9. Trademark / trade-dress note (practical, non-legal-advice)

**Do not ship:**
- The word "Instagram" or the Instagram wordmark anywhere in the UI or copy.
- The Instagram **logo glyph** (the camera-outline icon) or its signature pink→orange→yellow
  gradient — that gradient is one of the most recognizable, distinctly-Instagram visual
  assets and is the single highest-risk element to reuse. Use a **generic camera glyph** (a
  plain outlined camera/circle icon, single flat color, no gradient) instead.
- Any explicit claim/branding that the product "is" or "looks exactly like Instagram" in
  marketing copy — that's what turns a UI-similarity question into a passing-off/consumer-
  confusion question, which is a materially bigger legal risk than the UI similarity itself.

**Lower risk, generally fine:**
- A **red "LIVE" badge in a top corner** is a category-wide convention, not distinctively
  Instagram's — YouTube, TikTok, Twitch, Facebook, and Snapchat all use visually similar red
  "LIVE" badges. This specific element is unlikely to be found distinctive/protectable on its
  own (per general trade-dress doctrine: protection requires the combination be non-functional
  *and* distinctive/source-identifying — a red live-indicator badge is functional/conventional
  across the entire industry).
- A bottom comment bar, floating comments, and floating hearts are likewise near-universal
  live-streaming UI conventions (Facebook Live popularized the flying-hearts pattern; it's not
  Instagram-specific), so replicating the *category pattern* is lower risk than replicating
  Instagram's *specific brand assets* (logo, wordmark, gradient, exact typography-as-brand-
  asset).
- Overall combination/"look and feel": trade dress protection would require proving the
  specific combination is both non-functional and distinctive of Instagram specifically, which
  is a harder bar given how much of this pattern is shared industry-wide. The practical
  guidance from general trade-dress commentary is that near-identical *functional* UI layouts
  (which this largely is — a comment bar, a live badge, a close button) get little protection,
  while *brand* elements (logo, wordmark, brand gradient, name) get strong protection.

**Practical recommendation for this project:** keep the *category-standard* live-stream visual
language (red badge, comment stream, hearts, translucent bottom bar) — that's what sells the
illusion and it's the lowest-risk part to replicate — and deliberately avoid the *brand-specific*
assets (logo, gradient, wordmark, "Instagram" name) even though those are the parts a resemblance
audit would look at first. This isn't a substitute for legal review if the project is
distributed commercially at scale, but it's the practical line most similar "looks like a live
stream" apps and demo/prank tools already sit on.

---

## Sources

- [Instagram Turns on IG Live Badges by Default for Eligible Creators — Social Media Today](https://www.socialmediatoday.com/news/instagram-turns-on-ig-live-badges-by-default-for-eligible-creators/616858/) — paid comment "badges" feature (not the LIVE status badge itself), viewer-count/eye-icon confirmation.
- [Live | Instagram Help Center](https://help.instagram.com/272122157758915/)
- [View insights on your Instagram Live videos — Instagram Help Center](https://help.instagram.com/148629740583709/?helpref=related_articles) — eye-icon viewer counter confirmation.
- [Share a live broadcast on Instagram after it's ended — Instagram Help Center](https://help.instagram.com/562982737951475) — end-screen / 24-hour replay share behavior.
- [View a replay of your own live video on Instagram — Instagram Help Center](https://help.instagram.com/100925250516299/)
- [How to Go Live on Instagram: 2025 Step-by-Step Guide — ActionSprout](https://actionsprout.com/blog/how-to-go-live-on-instagram/) — 3-2-1 countdown confirmation, comment bar description.
- [How to Go Live on Instagram in 2026 — Riverside](https://riverside.com/blog/how-to-go-live-on-instagram)
- [Instagram Live: A Step-by-step Guide for Businesses — Later](https://later.com/blog/instagram-live/) — comment bar and "⋯ turn off commenting" control.
- [Instagram Live Producer: Enhanced Live Streams — about.instagram.com](https://about.instagram.com/blog/tips-and-tricks/instagram-live-producer) — Practice vs. Public audience selector.
- [Instagram Adds Live Requests, Providing New Options for Live Guests — Social Media Today](https://www.socialmediatoday.com/news/instagram-adds-live-requests-providing-new-options-for-live-guests/511490/) — guest-request smiley icon + red count badge.
- [New: Request to Join a Friend's Live Video — about.instagram.com](https://about.instagram.com/blog/announcements/new-request-to-join-a-friends-live-video)
- [What Font Does Instagram Use in 2025? — FontsArena](https://fontsarena.com/blog/what-font-does-instagram-use/) — SF Pro (iOS) / Roboto (Android) as the app interface font, Instagram Sans as brand-only font.
- [Instagram Live Stream Flying Hearts Pack — VideoHive](https://videohive.net/item/live-stream-flying-hearts-pack/30586564) — multi-color flying-hearts visual pattern (third-party recreation, not a Meta spec).
- [Instagram Live Heart like animation in React Native using Reanimated](https://anexpertcoder.hashnode.dev/floating-heart-animation-using-react-native-reanimated) — implementation pattern for the floating-heart effect.
- [Instagram Colors — Hex, RGB, CMYK, Pantone — U.S. Brand Colors](https://usbrandcolors.com/instagram-colors/) — brand red reference (`#FD1D1D`), not Live-badge-specific.
- [Legal protection of user interface and user experience design — Lexology](https://www.lexology.com/library/detail.aspx?g=1290012b-8072-48e8-bcec-e4826ff9c654) — trade-dress framework used for §9.
- [When Is a 'Dupe' Too Similar? Legal Lines in Trade Dress and Patents — Isaboke Law](https://www.isabokelaw.com/blog/when-is-a-dupe-too-similar-legal-lines-in-trade-dress-and-patents) — trade-dress distinctiveness/functionality framework used for §9.

Not found / not verifiable from available sources (flagged rather than guessed with false
confidence): exact hex values for the LIVE badge and comment-bar chip, exact join/system-message
copy strings, exact bottom-bar icon left-to-right order, exact comment-fade timing, exact
countdown visual treatment, exact end-screen copy/button labels.
