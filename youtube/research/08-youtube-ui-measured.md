# R8 — YouTube UI, Measured

A build specification derived from the running product, not from memory. Every number below was read
out of `getComputedStyle` / `getBoundingClientRect` on www.youtube.com and is reproduced here verbatim.
Where a value looks arbitrary (`326.8px`, `48.13px`, `#f03`), it is recorded as measured — arbitrary
values are exactly what reconstruction-from-memory gets wrong.

## Provenance

| Field | Value |
| --- | --- |
| Captured | 2026-08-16 |
| Origin | `https://www.youtube.com` |
| Session | **Logged out** (`ytcfg.get('LOGGED_IN') === false`), fresh cookie jar |
| Locale / region | `HL=en`, `GL=US` |
| `INNERTUBE_CLIENT_VERSION` | `2.20260813.05.00` |
| Browser | Chrome 151, `devicePixelRatio = 1` |
| Viewport | 1920×1080 unless a row says otherwise |
| Theme | Light unless a row says otherwise; dark forced with `html[dark]` |

Root attributes present on `<html>` — these gate whole style branches, so a replica should decide
consciously which of them it is emulating:

```
lang="en" darker-dark-theme darker-dark-theme-deprecate system-icons
color-version="v2_0" typography typography-spacing
style="font-size: 62.5%; font-family: Roboto, Arial, sans-serif; …"
```

`<body dir="ltr" rounded-container>`.

**`font-size: 62.5%` on `<html>` means `1rem = 10px`.** Every token in YouTube's scale is expressed in
rem against that base, so `1.4rem` is `14px`. Do not carry the rem values into a project with a 16px
root without converting.

### Two caveats that change what you should copy

1. **The player is on YouTube's new "delhi-modern" chrome.** `#movie_player` carries
   `ytp-delhi-modern ytp-delhi-modern-icons ytp-delhi-horizontal-volume-controls
   ytp-delhi-modern-compact-controls ytp-disable-bottom-gradient`. The familiar dark gradient scrim
   behind the controls is **switched off** (`.ytp-gradient-bottom` computes `display: none`) and the
   controls instead sit on translucent pills. Section 5 documents both: the pills as they render now,
   and the legacy gradient as it is still defined, so the build can choose.
2. **The logged-out home feed starts empty.** A cold visitor gets an empty state, not a grid
   (section 8). The grid only appears once the session has watch history.

## 0. Headline findings — where memory would be wrong

| Belief in circulation | What the product actually does |
| --- | --- |
| Tokens are `--yt-spec-*` | **Zero `--yt-spec-*` custom properties exist.** The live namespace is `--yt-sys-color-*` (190 resolved on `<html>`). A second, per-build set of minified aliases `--t{16 hex digits}` (117 of them) holds the same values under names that change every deploy — never reference those. |
| Brand red is `#ff0000` | The player brand red is **`#f03`** (`#ff0033`): `.ytp-swatch-background-color { background-color: var(--yt-sys-color-baseline--static-brand-red, #f03) }`. The logo's play badge is also `#FF0033`. |
| The played portion of the progress bar is flat red | It is a gradient: `linear-gradient(90deg, rgb(255,0,51) 80%, rgb(255,39,145))`, sized to the **full bar width** (`background-size: 1320px`) so the pink tail only shows near the end. |
| Home is a 4-up grid of ~360px cards at 1920 | At 1920 with the nav expanded it is **3 columns of 533.33px cards**. Column count is driven by the *content* width, not the viewport: collapse the nav at the same 1920 and it becomes **4 columns**. |
| The card thumbnail has square corners | `border-radius: 12px`, `overflow: hidden`, aspect enforced by `padding-top: 299.992px` (56.25%). |
| View counts and subscriber counts use the same abbreviation | They do not. Views round to 2 significant digits (`1.1M`, `3.4M`); subscribers keep 3 (`7.06M`, `1.69M`, `15.5M`). |
| Related-sidebar items say "858K views · 2 years ago" | They say **`858K`** (with a play glyph) and **`2y ago`** — abbreviated units, no "views" word. |
| The control bar sits on a CSS gradient | It sits on translucent pills; the gradient asset is a 1×198 base64 **PNG**, and it is disabled in this build. |

## 1. Colour

### 1.1 The token system

Namespace: `--yt-sys-color-<group>--<name>`. Groups seen: `baseline` (the bulk), plus themed/add-on
ramps. Full light+dark dump: `extracted/tokens-yt-sys-color.json` (190 tokens, 115 of which differ
between themes). Everything declared anywhere in the page, including legacy names:
`extracted/tokens-light-and-dark.json` (930 resolved) and the theme delta in
`extracted/tokens-theme-diff.json`.

Core tokens a replica actually needs:

| Token | Light | Dark |
| --- | --- | --- |
| `--yt-sys-color-baseline--base-background` | `#fff` | `#0f0f0f` |
| `--yt-sys-color-baseline--raised-background` | `#fff` | `#212121` |
| `--yt-sys-color-baseline--inverted-background` | `#0f0f0f` | `#f1f1f1` |
| `--yt-sys-color-baseline--inverted-background-hover` | `#3f3f3f` | `#d9d9d9` |
| `--yt-sys-color-baseline--text-primary` | `#0f0f0f` | `#f1f1f1` |
| `--yt-sys-color-baseline--text-secondary` | `#606060` | `#aaa` |
| `--yt-sys-color-baseline--text-disabled` | `#909090` | `#717171` |
| `--yt-sys-color-baseline--outline` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.2)` |
| `--yt-sys-color-baseline--additive-background` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.1)` |
| `--yt-sys-color-baseline--additive-background-inverse` | `rgba(255,255,255,0.1)` | `rgba(0,0,0,0.05)` |
| `--yt-sys-color-baseline--button-chip-background-hover` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.2)` |
| `--yt-sys-color-baseline--call-to-action` | `#065fd4` | `#3ea6ff` |
| `--yt-sys-color-baseline--call-to-action-hover` | `#0556bf` | `#65b8ff` |
| `--yt-sys-color-baseline--call-to-action-inverse` | `#3ea6ff` | `#065fd4` |
| `--yt-sys-color-baseline--static-brand-red` | `#f03` | `#f03` (unchanged) |
| `--yt-sys-color-baseline--brand-red-contrast` | `#c30027` | `#f57` |
| `--yt-sys-color-baseline--error-indicator` | `#c30027` | `#f57` |
| `--yt-sys-color-baseline--icon-warning` | `#be8800` | `#fbc02d` |
| `--yt-sys-color-baseline--frosted-glass-desktop` | `rgba(255,255,255,0.9)` | `rgba(15,15,15,0.8)` |
| `--yt-sys-color-baseline--overlay-button-secondary` | `rgba(255,255,255,0.1)` | same |
| `--yt-sys-color-baseline--overlay-tonal-hover` | `rgba(255,255,255,0.2)` | same |

Note `static-brand-red`, `overlay-button-secondary` and `overlay-tonal-hover` are theme-invariant —
they describe ink over video, not over the page.

Legacy `--yt-deprecated-*` names still resolve (`--yt-deprecated-dark-blue: #065fd4`,
`--yt-deprecated-grey-5: #606060`, `--yt-deprecated-white-3: #f1f1f1`, …). They are shims; build
against `--yt-sys-color-*`.

### 1.2 Computed colours per component

Measured on the element, not inferred from a token. Light / dark.

| Surface | Property | Light | Dark |
| --- | --- | --- | --- |
| Page (`ytd-app`) | background | `rgb(255,255,255)` | `rgb(15,15,15)` |
| Masthead `#container` | background | transparent over page | transparent over page |
| Left nav drawer | background | transparent over page | transparent over page |
| Card title | color | `rgb(15,15,15)` | `rgb(241,241,241)` |
| Card title (hover) | color | `rgb(10,13,54)` — read once off an already-visited link; there is no declared hover colour, so treat the title as colour-stable on hover | — |
| Card metadata / byline | color | `rgb(96,96,96)` | `rgb(170,170,170)` |
| Card metadata delimiter `•` | color | `rgb(96,96,96)` | `rgb(170,170,170)` |
| Duration badge | bg / color | `rgba(0,0,0,0.6)` / `rgb(255,255,255)` | same |
| Chip — selected | bg / color | `rgb(15,15,15)` / `rgb(241,241,241)` | *not measured*; expected to swap to `--…inverted-background` = `#f1f1f1` on `#0f0f0f` |
| Chip — unselected | bg / color | `rgba(0,0,0,0.05)` / `rgb(15,15,15)` | *not measured*; expected `rgba(255,255,255,0.1)` / `#f1f1f1` from `--…additive-background` |
| Guide entry | color | `rgb(15,15,15)` | `rgb(241,241,241)` |
| Guide entry (hover) | bg | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.1)` |
| Search field | bg / border | `rgb(255,255,255)` / `1px solid rgb(198,198,198)` | `rgb(33,33,33)` / `1px solid rgb(198,198,198)` |
| Search field, focused | border | `1px solid rgb(28,98,185)` | — |
| Search field | inner shadow | `rgb(238,238,238) 0 1px 2px 0 inset` | — |
| Search submit button | bg / border | `rgb(248,248,248)` / `1px solid rgb(211,211,211)` | — |
| Search submit (hover) | bg | `rgb(240,240,240)` | — |
| Sign in button | bg / color / border | transparent / `rgb(6,95,212)` / `1px solid rgba(0,0,0,0.2)` | `rgb(62,166,255)` |
| Sign in (hover) | bg / border | `rgb(222,241,255)` / transparent | — |
| Subscribe button (filled) | bg / color | `rgb(15,15,15)` / `rgb(241,241,241)` | `rgb(241,241,241)` / `rgb(15,15,15)` |
| Watch action button (tonal) | bg / color | `rgba(0,0,0,0.05)` / `rgb(15,15,15)` | `rgba(255,255,255,0.1)` / `rgb(241,241,241)` |
| Card overflow button (hover) | bg | `rgba(0,0,0,0.2)` | — |
| Suggestion dropdown | bg / shadow | `rgb(255,255,255)` / `rgba(0,0,0,0.2) 0 2px 4px 0` | — |

**Card hover tint is dynamic.** `.ytSpecTouchFeedbackShapeFill` / `…Stroke` /
`…HoverEffect` on a card measured `rgba(220,139,50,0.13)` — an orange keyed to that card's
thumbnail, not a fixed grey. A replica that wants the effect must sample the thumbnail; a replica that
does not should use `--yt-sys-color-baseline--additive-background` (`rgba(0,0,0,0.05)`) and accept the
difference.

### 1.3 Player colours

| Part | Value |
| --- | --- |
| Progress track (`.ytp-progress-list`) | `rgba(40,40,40,0.6)` |
| Buffered (`.ytp-load-progress`) | `rgba(255,255,255,0.4)` |
| Hover-ahead (`.ytp-hover-progress`) | `rgba(255,255,255,0.5)` |
| Played (`.ytp-play-progress`) | `linear-gradient(90deg, rgb(255,0,51) 80%, rgb(255,39,145))`, `background-size: <bar width>px`, `background-position-x: 0` |
| Played, during an ad | flat `rgb(255,204,0)` |
| Scrubber handle | `rgb(255,0,51)` |
| Control pills | `rgba(0,0,0,0.3)` |
| Control-bar icon / text ink | `rgb(238,238,238)` |
| Settings panel | `rgba(0,0,0,0.6)` |
| Panel header rule | `1px rgba(255,255,255,0.2)` |
| Pill button hover | `rgba(255,255,255,0.1)`; active `rgba(255,255,255,0.2)` |

The played gradient being sized to the whole bar is the subtle part: at 10% progress you see only the
`#ff0033` end; the pink only appears as playback approaches the right edge.

## 2. Typography

Family: **`Roboto, Arial, sans-serif`** everywhere in the app chrome (`--font-family: Roboto`).
Two exceptions:

- `--display-font-family: YouTube Sans` — proprietary, used only for display-scale text. Substitute.
- The player uses `"YouTube Noto", Roboto, Arial, Helvetica, sans-serif`.

**Roboto is Apache-2.0 licensed and may be shipped with this project.** YouTube Sans and YouTube Noto
may not; fall back to Roboto for those roles.

### 2.1 The token scale (rem; ×10 for px at the 62.5% root)

| Role | Size | `size` | `leading-default` | `leading-tall` |
| --- | --- | --- | --- | --- |
| display | l / m / s / xs | 6.4 / 4.8 / 3.6 / 2.8rem | 7.8 / 5.8 / 4.4 / 3.4rem | 9 / 6.6 / 5 / 3.8rem |
| headline | l / m / s / xs | 3.6 / 2.8 / 2.4 / 2rem | 4.4 / 3.4 / 3 / 2.4rem | 5 / 3.8 / 3.2 / 2.8rem |
| body | xl / l / m / s / xs | 1.8 / 1.6 / 1.4 / 1.2 / 1rem | 2.2 / 2 / 1.8 / 1.6 / 1.4rem | 2.6 / 2.2 / 2 / 1.8 / 1.6rem |
| action | xl / l / m / s / xs | 1.8 / 1.6 / 1.4 / 1.2 / 1rem | 2.2 / 2 / 1.8 / 1.6 / 1.4rem | 2.6 / 2.2 / 2 / 1.8 / 1.6rem |

Weights: `display 300/700`, `headline 700/900`, `body 400/500`, `action 500/700` (default/heavy).
`body` and `action` share a metric scale and differ only in default weight — 400 vs 500.

### 2.2 Measured type per component

Every row read off the live element. `letter-spacing: normal` on all of them unless noted.

| Component | px | line-height | weight | colour (light) |
| --- | --- | --- | --- | --- |
| Card title (`.ytLockupMetadataViewModelTitle`) | 16 | 22 | 500 | `#0f0f0f` |
| Card metadata rows (channel, views, age) | 14 | 20 | 400 | `#606060` |
| Duration badge | 12 | 18 | 500 | `#fff` |
| Shelf heading ("Shorts") | 15 | normal | 700 | inherits |
| Chip label | 14 | 20 | 500 | `#0f0f0f` / `#f1f1f1` when selected |
| Guide entry title | 14 | 20 | 400 (500 when active) | `#0f0f0f` |
| Guide section heading ("Explore") | 16 | 22 | 500 | `#0f0f0f` |
| Mini-guide entry label | 10 | 16 | 400 | `#0f0f0f` |
| Search input | 16 | 22 | 400 | `#0f0f0f` |
| Suggestion row | 16 | normal | 400 | `#0f0f0f` |
| Sign-in / Subscribe / action button label | 14 | 40 (= button height) | 500 | per §1.2 |
| Watch title `h1` | 20 | 28 | 700 | `#0f0f0f` |
| Watch info line ("961K views  10 months ago") | 14 | 20 | 500 | `#0f0f0f` |
| Channel name on watch | 16 | 22 | 500 | `#0f0f0f` |
| Subscriber count on watch | 12 | 18 | 400 | `#606060` |
| Description body | 14 | 20 | 400 | `#0f0f0f` |
| Comment count heading ("233 Comments") | 15 | normal | 700 | inherits |
| Comment author | 12 | 18 | 500 | `#0f0f0f` |
| Comment timestamp | 12 | 18 | 400 | `#606060` |
| Comment body | 14 | 20 | 400 | `#0f0f0f` |
| Search-result title | 18 | 26 | 400 | `#0f0f0f` |
| Search-result description snippet | 12 | 18 | 400 | `#606060` |
| Channel tab label | 14 | normal | 500 | `#606060` |
| Player time display | 14 | 40 | 500 | `rgb(238,238,238)` |
| Player settings menu row | 11 | 14.3 | 400 | `rgb(238,238,238)` |
| Player quality panel header | 11.99 | — | 400 | `rgb(238,238,238)` |
| Scrub tooltip | 12.98 | 15 | 500 | `rgb(238,238,238)` |

Two oddities worth preserving: the settings menu runs at **11px / 14.3px**, far below anything else in
the product, and the search-result title is the only 18px/26px text on the page.

Legacy letter-spacing tokens that still resolve, if you need them:
`--yt-caption-letter-spacing: 0.35px`, `--yt-badge-letter-spacing: 0.35px`,
`--yt-link-letter-spacing: 0.25px`, `--yt-guide-highlight-letter-spacing: 0.25px`.

## 3. Layout geometry

### 3.1 Fixed chrome

| Element | Value |
| --- | --- |
| Masthead height | **56px** (`ytd-masthead #container`, full-bleed, `padding: 0 16px`) |
| Masthead `#start` | 169×56 at x=16 |
| Masthead `#center` | 732×40 at y=8 |
| Masthead `#end` | 225×40 at y=8 |
| Guide (hamburger) button | 24×24 icon at x=24, y=16 |
| Logo lockup | 129×56, SVG box **93×20** |
| Search field | 536×40, `radius 40px 0 0 40px`, `padding 0 4px 0 16px` |
| Search field, focused | width **568** (grows 32px), `padding 2px 4px 2px 48px` (icon slides in on the left) |
| Search submit button | 64×40, `radius 0 40px 40px 0` |
| Voice search button | 40×40, `radius 100px`, bg `rgba(0,0,0,0.05)` |
| Settings (kebab) button | 24×24 |
| Sign in button | 98.62×40, `radius 20px`, `padding 0 15px` |
| Left nav — expanded | **240px** wide, top 56 |
| Left nav — mini | **72px** wide, `padding: 0 4px` |
| Chip bar height | **56px** (chips themselves 32px tall, centred) |

### 3.2 Breakpoints (binary-searched to the pixel)

| Transition | Last px of lower state | First px of upper state |
| --- | --- | --- |
| Left nav hidden → mini | 791 | **792** |
| Left nav mini → expanded | 1312 | **1313** |
| Home grid 1 → 2 columns | 571 | **572** |
| Home grid 2 → 3 columns | 961 | **962** |
| Watch sidebar hidden → beside player | 999 | **1000** |

The watch sidebar does not stack below the player at narrow widths in this build — `#secondary`
becomes non-rendering (zero client rects) below 1000px and the related list disappears entirely.

### 3.3 Home grid, measured at each width

Nav in its default state for that width. `--ytd-rich-grid-items-per-row` is authoritative for the
column count; the measured item width is what the browser actually produced.

| Viewport | Nav | Content x-origin | Grid width | cols | item w | thumb | h-gap | item margin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1920 | expanded 240 | 240 | 1680 | 3 | 533.33 | 533.33×299.99 | 16 | 16px |
| 1600 | expanded 240 | 240 | 1360 | 3 | 426.66 | 426.66×239.99 | 16 | 16px |
| 1440 | expanded 240 | 240 | 1200 | 3 | 373.33 | 373.33×209.99 | 16 | 16px |
| 1366 | expanded 240 | 240 | 1126 | 3 | 348.66 | 348.66×196.12 | 16 | 16px |
| 1280 | mini 72 | 72 | 1208 | 3 | 375.99 | 375.99×211.49 | 16 | 16px |
| 1024 | mini 72 | 72 | 952 | 3 | 290.66 | 290.66×163.49 | 16 | 16px |
| 900 | mini 72 | 72 | 828 | 2 | 382 | 382×214.88 | 16 | 16px |
| 768 | hidden | 0 | 768 | 2 | 352 | 352×198 | 16 | 16px |
| 600 | hidden | 0 | 600 | 2 | 268 | 268×150.75 | 16 | 16px |
| 480 | hidden | 0 | 480 | 1 | 440 | 440×247.5 | 16 | **8px** |
| 360 | hidden | 0 | 360 | 1 | 320 | 320×180 | 16 | **8px** |
| 1920, nav collapsed | mini 72 | 72 | 1848 | **4** | 438 | — | 16 | 16px |

Grid custom properties, constant across widths except where noted:

```
--ytd-rich-grid-item-min-width: 326.8px      /* arbitrary; recorded as measured */
--ytd-rich-grid-item-max-width: 700px
--ytd-rich-grid-item-margin: 16px            /* 8px at ≤571px */
--ytd-rich-grid-gutter-margin: 16px
--ytd-rich-grid-content-max-width: calc(N*(700px + 16px) - 16px)
--ytd-rich-grid-slim-items-per-row: 5
```

Reproducible width formula, verified at 1920: `itemW = (gridWidth − 2×16 − N×16) / N`
→ `(1680 − 32 − 48)/3 = 533.33`. Each item carries `margin: 0 8px 32px`, so the 16px horizontal
"gap" is two 8px margins and **the row separation is the 32px bottom margin**.

A raw bottom-to-top measurement between one card and the next row read 76px — do not build to that
number. Cards in a row have different heights (a 1-line title is 22px shorter than a 2-line one) while
the next row starts at a single y, so the observed gap varies per card. `margin-bottom: 32px` is the
value that is actually declared.

### 3.4 Watch page

At 1920×1080, theatre off:

| Part | Value |
| --- | --- |
| `#primary` | 1360 wide, left edge x=16 |
| `#secondary` | 544 wide, right edge x=1920 |
| Gap between columns | 0 measured — separation comes from `#secondary`'s own inner padding |
| `--ytd-watch-flexy-sidebar-width` | **528px** |
| `--ytd-watch-flexy-sidebar-min-width` | 320px |
| `--ytd-watch-flexy-max-player-width` | `calc((100vh − 56px − 12px − 48px) × (16/9))` |
| `--ytd-watch-flexy-min-player-width` | `calc(480px × (16/9))` = 853.33px |
| `--ytd-watch-flexy-space-below-player` | 48px |
| `--ytd-watch-flexy-masthead-height` | 56px |
| `--ytd-watch-flexy-panel-max-height` | 827px (viewport-derived) |
| Player element | 1344×756 (16:9) |
| Theatre mode | player 1920×911, full-bleed; `#secondary` moves to y=991 (below) |
| Theatre attributes on `ytd-watch-flexy` | `theater full-bleed-player cinematics-active cinematic-light-theme` |
| Fullscreen | `document.fullscreenElement` = `<html>`, player 1920×1080, control bar 1896 wide at left 12 |

Watch metadata block:

| Part | Value |
| --- | --- |
| `h1` title | 1344×28, `margin: 0` |
| Owner avatar | 40px |
| Subscribe button | 94.54×40, `radius 20px`, `padding 0 16px` |
| Like button | 84.66×40, `radius 20px 0 0 20px` |
| Dislike button | 56×40, `radius 0 20px 20px 0` (segmented pair, no gap) |
| Share / Save | 92.13×40 and 86.29×40, `radius 20px`, `padding 0 16px` |
| More actions | 40×40, `radius 20px` |
| Description container | full width, `padding 0`, transparent (the visible grey card is a child) |

Related sidebar (compact lockup):

| Part | Value |
| --- | --- |
| Item | 528×185.63 |
| Vertical gap | 8px |
| Thumbnail | 330×185.63, ratio 1.78, `radius 12px` |

### 3.5 Comments

| Part | Value |
| --- | --- |
| Top-level comment left edge | x=16 |
| Top-level avatar | 36×36 |
| Avatar → text gap | 16px (avatar right 52, text left 68) |
| **Reply indent** | **48px** (reply block starts at x=64) |
| Reply avatar | 24×24 |
| Reply text left edge | x=104 (again 16px after its avatar) |
| Reply container padding | `0` — the indent comes from the reply renderer's own left offset, not padding |
| Comment toolbar | 32px tall; like/dislike buttons 32×32; "Reply" 53.66×32 |

### 3.6 Search results

| Part | Value |
| --- | --- |
| `#primary` | 855 wide at x=440 |
| Result row (`ytd-video-renderer`) | 855×235.38 |
| Thumbnail | 419.5×235.38 (16:9), duration badge 48.44×20 inset bottom-right |
| Text column | 419.5 wide, starts x=875.5 (16px after the thumbnail) |
| Title | 18px/26px, 2-line clamp, block height 52 |
| Filter chips | `All, Shorts, Unwatched, Watched, Videos, Recently uploaded, Live` |

### 3.7 Channel page

| Part | Value |
| --- | --- |
| Tabs | `Home, Videos, Shorts, Playlists, Posts, ⌄` — 48px tall, 14px/500, `rgb(96,96,96)` when unselected |
| Videos-tab grid | 3 columns, item 419.99×314.24, h-gap 16, v-gap 32, x-origin 426 |
| Card on channel | thumbnail 419.99×236.24 `radius 12px`, **no avatar** (channel context), title 16/22/500 |
| Header text order | name → `@handle` → `•` → subscribers → `•` → video count → description → `...more` → links → Subscribe |

### 3.8 Shorts

| Part | Value |
| --- | --- |
| Route | `/shorts` |
| Video element | 554×984, ratio **0.56** (9:16), `object-fit: cover` |
| Overlay text order | `@handle` → `Subscribe` → title → like count → comment count → `Share` → `Remix` |

## 4. The video card — component spec

DOM outline (full dump: `extracted/card-dump-1920.json`, raw tree in
`extracted/dom-home-and-card.json`):

```
ytd-rich-item-renderer                          533.33×409.99  margin: 0 8px 32px
└ div#content                                   display:flex
  └ yt-lockup-view-model                        533.33×377.99
    └ div.ytLockupViewModelHost.ytLockupViewModelVertical
      ├ yt-touch-feedback-shape                 557.33×401.99  margin:-12px  radius:16px
      │   ├ .ytSpecTouchFeedbackShapeHoverEffect   ← dynamic tint sampled from the thumbnail
      │   ├ .ytSpecTouchFeedbackShapeStroke        1px solid <tint>
      │   └ .ytSpecTouchFeedbackShapeFill          <tint>
      ├ a.ytLockupViewModelContentImage          533.33×311.99  padding-bottom: 12px
      │ └ yt-thumbnail-view-model                533.33×299.99  radius:12px  overflow:hidden
      │   ├ div.ytThumbnailViewModelImage        └ img  object-fit: cover
      │   └ yt-thumbnail-bottom-overlay-view-model            533.33×28
      │     └ div.…BadgeContainer                padding: 0 8px 8px 0   (8px inset from corner)
      │       └ badge-shape.ytBadgeShapeThumbnailDefault      38.45×20
      │           radius:4px  padding:1px 4px  bg rgba(0,0,0,.6)  12/18/500 #fff   e.g. "30:21"
      └ div.ytLockupViewModelMetadata            533.33×66
        └ yt-lockup-metadata-view-model
          ├ div.ytLockupMetadataViewModelAvatar  36×36  margin-right: 12px
          │ └ … img  border-radius: 50%
          ├ div.ytLockupMetadataViewModelTextContainer
          │ ├ h3.ytLockupMetadataViewModelHeadingReset        22 tall
          │ │ └ a.ytLockupMetadataViewModelTitle
          │ │      16/22/500 #0f0f0f  -webkit-line-clamp: 2  padding-right: 24px
          │ └ div.ytLockupMetadataViewModelMetadata           44 tall
          │   └ yt-content-metadata-view-model
          │     ├ div.…MetadataRow  (margin-top: 2px)  → channel name + verified glyph (14px box)
          │     └ div.…MetadataRow  (margin-top: 2px)  → "961K views" • "10 months ago"
          │          span.ytContentMetadataViewModelDelimiter  "•"  margin: 0 4px
          └ div.ytLockupMetadataViewModelMenuButton           40×40
            └ button  radius: 20px  icon 24×24
```

Derived geometry to build against:

| Measure | Value |
| --- | --- |
| Thumbnail aspect | 16:9, enforced by `padding-top: 299.992px` on a 533.33px box (56.25%) |
| Thumbnail radius | **12px** |
| Thumbnail → metadata gap | **12px** (`padding-bottom` on the image anchor) |
| Avatar diameter | **36px**, `border-radius: 50%`, 40px hit box (2px ring) |
| Avatar → text gap | **12px** |
| Title reserved height | 22px per line × 2 (clamped) |
| Metadata rows | 20px each, 2px top margin each |
| Overflow button | 40×40, radius 20px, 24px icon, sits at the right of the metadata row |
| Whole-card hover surface | 557.33×401.99 — 12px **larger on every side** than the card, radius 16px |

The hover surface being inset by −12px and rounded at 16px (versus the thumbnail's 12px) is the detail
that makes the hover read as a "card" rather than a highlighted thumbnail.

## 5. The player

Measured on a 1344×756 player. At this width the player is in its compact mode; the CSS defaults for a
larger player are noted where they differ, since they are what the class names imply.

### 5.1 Control bar

| Part | Measured | CSS default (`--yt-delhi-*`) |
| --- | --- | --- |
| `.ytp-chrome-bottom` height | **56px** | `--yt-delhi-bottom-controls-height: 72px` |
| `.ytp-chrome-bottom` | `left: 12px`, `width: 1320px`, `padding: 3px 0 0`, `z-index: 59` | — |
| Inset from player edge | 12px each side | — |
| `.ytp-left-controls` | 1072×56 | — |
| `.ytp-right-controls` | 248×40 pill, `radius 28px`, `padding 0 4px`, `margin-top 8px`, bg `rgba(0,0,0,0.3)` | height `--yt-delhi-pill-height: 48px`, `margin-top --yt-delhi-pill-top-height: 12px`, `padding 0 16px`, `backdrop-filter: blur(16px)` |
| Play button | 40×40, `border-radius: 50%`, bg `rgba(0,0,0,0.3)`, `margin-top 8px` | — |
| Mute button | 40×40 at x=80 | — |
| Time display | 115.3×56, `padding 8px`, 14/40/500 `rgb(238,238,238)` | — |
| Right-cluster buttons | 48×40 each: autoplay, subtitles, settings, theater, fullscreen | 48×48 at default pill height |
| Right-cluster icon shadow | `drop-shadow(rgba(0,0,0,0.8) 0 0 1px)` | — |
| Right-cluster button hover | `::before` 48px-wide pad, `radius 40px`, bg `rgba(255,255,255,0.1)`, `transition: background-color .2s cubic-bezier(.05,0,0,1)` | — |
| Right-cluster button active | bg `rgba(255,255,255,0.2)` | — |

Button icon viewBoxes: play/pause `0 0 36 36` rendered 36×36; every other control `0 0 24 24`
rendered 24×24.

Order, left to right: `play · mute · time` … `autoplay-toggle · subtitles · settings · theater ·
fullscreen`. `prev`, `next`, `pip`, `remote (Play on TV)` and `clip` exist in the DOM at 0×0 —
present but not rendered for this video.

### 5.2 Progress bar

| State | Value |
| --- | --- |
| Container | `.ytp-progress-bar-container`, 1320×**6px**, `position: absolute`, `bottom: 56px` (directly above the control bar) |
| Bar box | 6px tall in both states |
| **At rest** | `.ytp-progress-list` has `transform: scaleY(0.667)` → **4px of visible track** |
| **On hover** | `transform: none` → full **6px** |
| Track transition | `transform .2s cubic-bezier(0.05, 0, 0, 1)` |
| Scrubber at rest | 12×12, `border-radius: 6px`, `rgb(255,0,51)` |
| Scrubber on hover | `transform: scale(1.67)` → **20.04px** effective, `transition: transform .1s cubic-bezier(0.4, 0, 1, 1)` |
| Played | gradient, §1.3 |
| Buffered | `rgba(255,255,255,0.4)`, scaled by `transform: scaleX(fraction)` |
| Hover-ahead | `rgba(255,255,255,0.5)`, same scaleX technique |

All three segments are full-width elements scaled with `transform: scaleX()`, not width animations —
worth copying, it is why the bar never reflows.

### 5.3 Scrub tooltip and preview

Hovering the bar produces `.ytp-tooltip.ytp-bottom.ytp-tooltip-progress-bar-style.ytp-preview`:

| Part | Value |
| --- | --- |
| Tooltip box | 242.36×138, `radius 8px`, `padding 1px`, bg `rgb(255,255,255)` (a 1px white frame) |
| Preview image | 240.36×136, `radius 8px`, from the storyboard sprite `i.ytimg.com/sb/<id>/…` |
| Text | timestamp `13:39` plus the hint line `Pull up for precise seeking` |
| Text style | 12.98px/15px, 500, `rgb(238,238,238)` |

The preview frame comes from a sprite sheet with `background-position` offsets — a replica needs one
sprite per video or a per-second frame source.

### 5.4 Gradient scrim (defined, currently disabled)

`.ytp-gradient-bottom` computes `display: none` in this build (`ytp-disable-bottom-gradient`). The
asset is still declared and is **not a CSS gradient** — it is a base64 PNG, 1×198, pure black with an
alpha ramp only. Decoded ramp in `extracted/player-gradient-decoded.json`.

- Bottom band = image rows 99–197, `background-position: 50% 100%`, `repeat-x`; element is
  `height: 61px` + `padding-top: 37px` = 98px total.
- Top band = rows 0–97, `height: 48px` + `padding-bottom: 50px` = 98px total.
- Peak alpha **170/255 = 0.667** at the video edge, decaying to 0.
- Both fade with `transition: opacity .25s cubic-bezier(0, 0, 0.2, 1)`.

Faithful CSS equivalent (stops measured off the decoded ramp, 0% = away from the edge):

```css
background-image: linear-gradient(
  to top,
  rgba(0,0,0,0.667)  0%,
  rgba(0,0,0,0.588) 10%,
  rgba(0,0,0,0.494) 20%,
  rgba(0,0,0,0.392) 30%,
  rgba(0,0,0,0.286) 40%,
  rgba(0,0,0,0.192) 50%,
  rgba(0,0,0,0.114) 60%,
  rgba(0,0,0,0.059) 70%,
  rgba(0,0,0,0.027) 80%,
  rgba(0,0,0,0.012) 90%,
  rgba(0,0,0,0)    100%
);
```

Note how far from linear that is — half the opacity is gone in the first 25% of the band.

### 5.5 Time display

Format `M:SS / M:SS`, e.g. `0:05 / 30:20`, with the separator rendered as a distinct element whose
text is `" / "` (spaces included). Hours appear as `H:MM:SS` when the duration needs them (seen in
search results: `1:08:47`). No leading zero on the first unit. Elements:
`.ytp-time-current`, `.ytp-time-separator`, `.ytp-time-duration`.

### 5.6 Settings menu

| Part | Value |
| --- | --- |
| Panel | 385×401, bg `rgba(0,0,0,0.6)`, `radius 12px`, `padding 0`, `overflow hidden` |
| Inner `.ytp-panel-menu` | `padding: 8px` |
| Row height | **48.13px** (arbitrary; recorded as measured) |
| Row width | 369 |
| Row text | 11px/14.3px, 400 |
| Open transition | `opacity .1s cubic-bezier(0, 0, 0.2, 1)` |
| Rows | `Stable Volume`, `Voice boost`, `Annotations`, `Audio track`, `Subtitles/CC`, `Sleep timer`, `Playback speed`, `Quality` |
| Row layout | label left, current value right (e.g. `Quality` → `Auto (720p)`) |

Quality submenu:

| Part | Value |
| --- | --- |
| Panel | 251×410, same bg and radius |
| Header | `Quality`, 251×57, `padding 8px 0`, bottom rule `1px rgba(255,255,255,0.2)`, 11.99px |
| Rows | 48px tall each |
| Options | `1080p HD`, `720p`, `480p`, `360p`, `240p`, `144p`, `Auto` |

The panel narrows from 385 to 251 when the submenu opens — the menu resizes to its content rather than
keeping a fixed width.

## 6. Motion

| Interaction | Duration | Easing | Property |
| --- | --- | --- | --- |
| Control bar / gradient auto-hide fade | **0.25s** | `cubic-bezier(0, 0, 0.2, 1)` | `opacity` |
| Progress bar grow on hover | **0.2s** | `cubic-bezier(0.05, 0, 0, 1)` | `transform` |
| Scrubber grow on hover | **0.1s** | `cubic-bezier(0.4, 0, 1, 1)` | `transform` |
| Player pill button hover tint | **0.2s** | `cubic-bezier(0.05, 0, 0, 1)` | `background-color` |
| Settings menu open | **0.1s** | `cubic-bezier(0, 0, 0.2, 1)` | `opacity` |
| Play button fade | **0.1s** | `cubic-bezier(0.4, 0, 1, 1)` | `opacity` |
| xsmall right-cluster expand chevron | 0.3s | `cubic-bezier(0.05, 0, 0, 1)` | `transform` |
| Left nav drawer | — | — | `transition-property: visibility` only — **the drawer does not animate its width**; the content area reflows immediately |
| Guide entry / chip / card / button hover | `transition: all` with no duration set | — | instant |

`cubic-bezier(0.05, 0, 0, 1)` is the house easing for anything that moves; `cubic-bezier(0, 0, 0.2, 1)`
(Material "decelerate") is used for opacity.

The control bar auto-hide **delay** is JS-driven (the player adds/removes `ytp-autohide`), not a CSS
`transition-delay`; only the 0.25s fade is expressed in CSS.

`<html>` also carries a set of view-transition timings used for thumbnail→watch navigation, worth
copying if the replica animates page transitions:

```
--ytd-vtm-exit-ms: 50ms;   --ytd-vtm-wait-ms: 50ms;   --ytd-vtm-delay-ms: 100ms;  --ytd-vtm-enter-ms: 200ms;
--ytd-vtm-watch-exit-ms: 50ms;  --ytd-vtm-watch-wait-ms: 50ms;  --ytd-vtm-watch-enter-ms: 50ms;
--ytd-vtm-watch-next-exit-ms: 250ms;  --ytd-vtm-watch-next-wait-ms: 50ms;
--ytd-vtm-watch-next-delay-ms: 0ms;   --ytd-vtm-watch-next-enter-ms: 250ms;
```

## 7. Iconography

All UI icons are **inline SVG, fill-only, no strokes**, `viewBox="0 0 24 24"`, rendered at 24×24, with
`fill` inherited from the element's `color`. Rounded terminals are baked into the path
(`a1 1 0 …` arcs), so scaling is safe and no `stroke-linecap` is needed. Two exceptions: the player's
play/pause uses `viewBox="0 0 36 36"` at 36×36, and some collapse chevrons use `0 0 18 18`.

Complete path data for 78 unique icons: `extracted/icons-svg-paths.json`, keyed by scope
(`masthead`, `guide`, `miniGuide`, `chipbar`, `grid`, `playerControls`, `watchActions`, `comments`,
`relatedSidebar`) and by accessible label.

Redraw references for the ones a replica needs first:

| Icon | Where | Path (`viewBox="0 0 24 24"`) / description |
| --- | --- | --- |
| Menu (hamburger) | masthead | `M20 5H4a1 1 0 000 2h16a1 1 0 100-2Zm0 6H4a1 1 0 000 2h16a1 1 0 000-2Zm0 6H4a1 1 0 000 2h16a1 1 0 000-2Z` — three 2px-tall fully-rounded bars at y=5/11/17, x from 4 to 20 |
| Search | masthead | `M11 2a9 9 0 105.641 16.01.966.966 0 00.152.197l3.5 3.5a1 1 0 101.414-1.414l-3.5-3.5a1 1 0 00-.197-.153A8.96 8.96 0 0020 11a9 9 0 00-9-9Zm0 2a7 7 0 110 14 7 7 0 010-14Z` — r=8 ring (2px stroke as fill) centred (11,11) + 2px rounded handle to (21,21) |
| Microphone | masthead | `M18.063 14.5a1 1 0 111.73 1A8.998 8.998 0 0113 19.942V22a1 1 0 11-2 0v-2.058A8.999 8.999 0 014.206 15.5l.866-.5.865-.5a7.002 7.002 0 0012.125 0ZM12 1a5 5 0 015 5v5a5 5 0 01-10 0V6a5 5 0 015-5Z…` — 10×14 rounded capsule, U-shaped cradle, 2px stem, 2px base |
| Kebab (more) | masthead, card | `M12 4a2 2 0 100 4 2 2 0 000-4Zm0 6a2 2 0 100 4 2 2 0 000-4Zm0 6a2 2 0 100 4 2 2 0 000-4Z` — three r=2 dots at y=6/12/18 |
| Account (sign in) | masthead | `M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 016.447 15.276 7 7 0 00-12.895 0A9 9 0 0112 3Zm0 2a4 4 0 100 8 4 4 0 000-8Zm0 2a2 2 0 110 4 2 2 0 010-4Z…` — r=11 ring, r=4 head ring, shoulders arc; rendered **18×18** at `rgb(6,95,212)` |
| Home | guide, mini-guide | `m11.485 2.143-8 4.8-2 1.2a1 1 0 001.03 1.714L3 9.567V20a2 2 0 002 2h5v-8h4v8h5a2 2 0 002-2V9.567l.485.29a1 1 0 001.03-1.714l-2-1.2-8-4.8a1 1 0 00-1.03 0Z` — outlined house with a 4×8 door |
| Shorts (nav glyph) | guide, mini-guide | `m13.467 1.19-8 4.7a5 5 0 00-.255 8.46 5 5 0 005.32 8.462l8-4.7a5 5 0 00.258-8.462 5 5 0 001.641-6.464l-.12-.217a5 5 0 00-6.844-1.78…` — two overlapping rounded lozenges at ~30°, play triangle knocked out |
| Subscriptions | guide, mini-guide | `M18 1H6a2 2 0 00-2 2h16a2 2 0 00-2-2Zm3 4H3a2 2 0 00-2 2v13a2 2 0 002 2h18a2 2 0 002-2V7a2 2 0 00-2-2ZM3 20V7h18v13H3Zm13-6.5L10 10v7l6-3.5Z` — stacked-screens outline with a play triangle |
| History | guide | `M8.76 1.487a11 11 0 11-7.54 12.706 1 1 0 011.96-.4 9 9 0 0014.254 5.38A9 9 0 0016.79 4.38 9 9 0 004.518 7H7a1 1 0 010 2H1V3a1 1 0 012 0v2.678a11 11 0 015.76-4.192ZM12 6a1 1 0 00-1 1v5.58l.504.288 3.5…` — clock face with an anticlockwise arrow |
| Shopping | guide | `M16 6h4a2 2 0 012 2v10a4 4 0 01-4 4H6a4 4 0 01-4-4V8a2 2 0 012-2h4V4.344…` — bag with a handle arc |
| Music | guide | `M11 2.766v10.99a4.5 4.5 0 101.994 3.976L13 17.5V9.2l5.485 3.292A1 1 0 0020 11.634V6.966…` — flag-note |
| Movies & TV | guide | `M20 3H4a3 3 0 00-2.587 1.485…` — film strip with sprocket holes |
| Chevron down (Show more) | guide | `M18.707 8.793a1 1 0 00-1.414 0L12 14.086 6.707 8.793a1 1 0 10-1.414 1.414L12 16.914l6.707-6.707a1 1 0 000-1.414Z` — 2px rounded chevron, apex at (12,16.9) |
| Chevron down, small | grid ("Show more") | `viewBox="0 0 18 18"` · `M14.03 6.595a.75.75 0 00-1.004-.052l-.056.052L9 10.565l-3.97-3.97a.75.75 0 10-1.06 1.06L9 12.685l5.03-5.03…` — 1.5px stroke weight |
| Report history | guide | `m4 2.999-.146.073A1.55 1.55 0 003 4.454v16.545a1 1 0 102 0v-6.491a7.26 7.26 0 016.248.115l.752.376a8.94 8.94 0 008 0…` — flag on a 2px pole |
| Verified badge | card metadata, watch | 14×14 inline within the 20px metadata row, inherits `rgb(96,96,96)` |
| Chip bar arrows | chip bar | labelled `Previous` / `Next`, 56×56 hit area at the bar ends |

Brand marks — the YouTube wordmark (`viewBox="0 0 93 20"`, rendered 93×20, play badge `#FF0033`) and
the Premium / TV / Music / Kids / Shorts brand glyphs — were deliberately **not stored**. Their
entries in `icons-svg-paths.json` are marked `"brandLogo": true` with the path data removed. Only
their box metrics are kept. Draw your own mark.

## 8. Copy, counts and formatting rules

### 8.1 Number formatting

Derived from 86 distinct view strings and 9 subscriber strings sampled across five searches and the
home feed (`extracted/watch-comments-formats.json`).

**View counts** — abbreviated everywhere a card appears:

| Range | Rendering | Evidence |
| --- | --- | --- |
| ≥ 1,000 and < 10,000 | one decimal + `K` | `1.8K`, `2.6K`, `9.8K` |
| ≥ 10,000 and < 1,000,000 | integer + `K` | `10K`, `104K`, `961K` |
| ≥ 1,000,000 and < 10,000,000 | one decimal + `M` | `1.1M`, `3.4M`, `9.4M` |
| ≥ 10,000,000 and < 1,000,000,000 | integer + `M` | `11M`, `137M`, `694M` |
| ≥ 1,000,000,000 | one decimal + `B` | `1.2B`, `2.6B`, `4.4B` |
| exactly at a boundary | no trailing `.0` | `1K`, `1M`, `1B` |

The rule is **2 significant digits below 10 of a unit, then integer** — never `0.9K`, never `1.10M`.
No sample below 1,000 views appeared in the logged-out surfaces sampled, so the sub-1K rendering is
**not verified here**; treat "`847 views`, exact with no abbreviation" as an assumption to check.

Watch-page info line uses the **same** abbreviation as the cards — `961K views  10 months ago` — it is
not the comma-grouped exact figure. Exact figures do surface in `aria-label`s, e.g.
`like this video along with 6,259 other people`, which is where comma grouping appears
(`6,259`, `3,247,891`-style).

**Subscriber counts** keep **3 significant digits**, unlike views:

`218K subscribers` · `393K subscribers` · `1.24M subscribers` · `1.69M subscribers` ·
`3.35M subscribers` · `7.06M subscribers` · `15.5M subscribers` · `21.1M subscribers`

`1.24M` and `7.06M` would be `1.2M` and `7.1M` under the view-count rule. Two different formatters.

**Comment count**: `233 Comments` — exact, comma-grouped above 999, with a capitalised plural noun.

**Like count** on the watch button: abbreviated like views (`6.2K`), exact in the aria-label (`6,259`).

**Live**: `728 watching` (concurrent viewers, exact).

**Video count** on a channel: `526 videos` — exact, lowercase noun.

### 8.2 Relative time

Cards and the watch page use full words: `11 hours ago`, `10 days ago`, `2 weeks ago`,
`10 months ago`, `17 years ago`. Always `N unit ago`, singular at 1 (`1 day ago`).

Prefixes seen: `Streamed 4 days ago` (past live), `Updated 7 days ago` (playlists).

The **related sidebar abbreviates**: `2y ago`, `1mo ago`, `3w ago`, `4w ago` — and drops the word
"views" from the count, showing a play glyph plus `858K`. Same data, a different formatter, in the
same page. This is the single most likely thing to get wrong from memory.

### 8.3 Exact strings

Masthead / nav:

- Search placeholder: `Search`
- Buttons: `Sign in`
- Guide, top section: `Home`, `Shorts`, `Subscriptions`, `You`, `History`
- Guide sign-in promo: `Sign in to like videos, comment, and subscribe.` + button `Sign in`
- Guide section headings: `Explore`, `More from YouTube`
- Explore: `Shopping`, `Music`, `Movies & TV`, `Show more` (`Show less` once expanded — both entries
  exist in the DOM at all times)
- More from YouTube: `YouTube Premium`, `YouTube TV`, `YouTube Music`, `YouTube Kids`.
  The first entry is promotional and varies: the cold-start capture rendered it as
  `Try Premium for $0`, the warmed session as `YouTube Premium`. Treat the label as server-supplied.
- Trailing entry: `Report history`
- Mini-guide labels (4 only): `Home`, `Shorts`, `Subscriptions`, `You`
- Guide footer, line 1: `About  Press  Copyright  Contact us  Creators  Advertise  Developers`
- Guide footer, line 2: `Terms  Privacy  Policy & Safety  How YouTube works  Test new features  NFL Sunday Ticket`
- Guide footer, line 3: `© 2026 Google LLC`

Home:

- Cold-start empty state, title: `Try searching to get started`
- Cold-start empty state, body: `Start watching videos to help us build a feed of videos you'll love.`
- Chip bar always begins with `All` (selected by default); the rest are topic chips
- Shelf heading: `Shorts`

Watch:

- Action buttons: `Share`, `Save`, `Download`, plus the like/dislike pair and `More actions`
- Owner row: `Join` (membership, when offered) then `Subscribe`
- Description collapsed affordance: `...more`
- Comments header: `233 Comments` · `Sort by` · composer placeholder `Add a comment...`
- Comment toolbar: `Reply`
- Reply expander: `16 replies`

Search:

- Filter chips: `All`, `Shorts`, `Unwatched`, `Watched`, `Videos`, `Recently uploaded`, `Live`
- A nonsense query does **not** produce a "no results" panel; it produces
  `Did you mean: <corrected query>` followed by a `People also watched` shelf. There is no empty
  state to build for search on this surface.

Player:

- Tooltips carry their shortcut: `Pause keyboard shortcut k`, `Next (SHIFT+n)`, `Mute (m)`,
  `Theater mode (t)`, `Full screen (f)`, `Play on TV`, `Picture-in-picture`, `Settings`,
  `Autoplay is on`, `Subtitles/closed captions unavailable`
- Scrub hint: `Pull up for precise seeking`

Channel header order: `Veritasium` / `@veritasium` / `•` / `21.1M subscribers` / `•` / `526 videos` /
description / `...more` / link + `and 6 more links` / `Subscribe`.

## 9. Search box, focused, with suggestions

| Part | Value |
| --- | --- |
| Field at rest | 536×40 at x=642 |
| Field focused | 568×40 at x=610 — it grows **left** by 32px; the right edge stays put |
| Focused border | `1px solid rgb(28,98,185)` |
| Focused padding | `2px 4px 2px 48px` — a search glyph slides into the left inset |
| Dropdown | `.ytSearchboxComponentSuggestionsContainer`, 570×647 at x=610, y=52 |
| Dropdown chrome | bg `rgb(255,255,255)`, `radius 12px`, `padding 8px 0`, `box-shadow rgba(0,0,0,0.2) 0 2px 4px 0`, `z-index 2010` |
| Row | 552×**44**, `padding 0 28px 0 16px`, 16px/400, `rgb(15,15,15)` |
| Rows returned | 14 for a 6-character query |
| Row content | query text; entity rows add a second line (`How It's Made` / `Television series`) |

The dropdown is 2px wider than the focused field on each side (570 vs 568 at the same x) and hangs
4px below it.

## 10. DOM outlines for the component tree

### 10.1 Application shell

```
ytd-app
├ tp-yt-app-drawer#guide            240 wide, top 56, transition-property: visibility
│ └ #guide-content > ytd-guide-renderer
│   └ ytd-guide-section-renderer    padding: 12px, no border
│     ├ #guide-section-title        16/22/500, padding 6px 12px 4px
│     └ ytd-guide-entry-renderer    a: 204×40 at x=12, icon 24×24, icon→label gap 24px
├ ytd-mini-guide-renderer           72 wide, padding 0 4px
│ └ ytd-mini-guide-entry-renderer   64×76, radius 10px, a padding 16px 0 14px, label 10/16
├ ytd-masthead                      56 tall, padding 0 16px  (#start | #center | #end)
└ #page-manager                     margin-left: 240px (expanded) / 72px (mini) / 0 (hidden)
  └ ytd-browse | ytd-watch-flexy | ytd-search | ytd-shorts
```

### 10.2 Home

```
ytd-browse[page-subtype="home"]
└ ytd-two-column-browse-results-renderer > #primary
  ├ ytd-feed-filter-chip-bar-renderer        56 tall
  │ └ #chips-wrapper > #scroll-container (x=264) > #chips
  │   └ yt-chip-cloud-chip-renderer          32 tall, 12px gap between chips
  │     └ chip-shape > button.ytChipShapeButtonReset
  │       └ div.ytChipShapeChip.ytChipShape{Active|Inactive}.ytChipShapeOnlyTextPadding
  │            radius 8px · padding 0 12px · 14/20/500
  │            active:   bg #0f0f0f  color #f1f1f1
  │            inactive: bg rgba(0,0,0,.05)  color #0f0f0f
  └ ytd-rich-grid-renderer > #contents
    ├ ytd-rich-item-renderer  (video card, §4)
    ├ ytd-rich-item-renderer  (containing ytd-ad-slot-renderer → an ad; 4 of 37 on this load)
    └ ytd-rich-section-renderer > ytd-rich-shelf-renderer  ("Shorts")
```

Filter ad slots out before measuring a grid: the first item in `#contents` was an ad on every load,
and ad cards have a different metadata block (`feed-ad-metadata-view-model`,
`lockup-attachments-view-model` with `Watch` / `Learn more` buttons) and no channel/views row.

### 10.3 Watch

```
ytd-watch-flexy[theater?][full-bleed-player][cinematics-active][cinematic-light-theme]
└ #columns
  ├ #primary > #primary-inner                          1360 wide
  │ ├ #player-container-outer > #player-container-inner > ytd-player > #movie_player
  │ │   └ video · .ytp-gradient-top · .ytp-gradient-bottom(display:none)
  │ │     · .ytp-chrome-top · .ytp-chrome-bottom
  │ │        └ .ytp-progress-bar-container (6px, bottom:56px)
  │ │           └ .ytp-progress-bar > .ytp-progress-list
  │ │              > .ytp-load-progress · .ytp-hover-progress · .ytp-play-progress
  │ │              · .ytp-scrubber-container > .ytp-scrubber-button
  │ │        └ .ytp-chrome-controls > .ytp-left-controls | .ytp-right-controls
  │ ├ ytd-watch-metadata
  │ │ ├ h1                              20/28/700
  │ │ ├ #top-row → ytd-video-owner-renderer (avatar 40 · name 16/22/500 · subs 12/18/400)
  │ │ │           + #subscribe-button (94.54×40, radius 20)
  │ │ │           + #top-level-buttons-computed (like|dislike segmented, Share, Save, ⋯)
  │ │ └ #description → #description-inline-expander   14/20/400 · "...more"
  │ └ ytd-comments
  │   ├ ytd-comments-header-renderer    "233 Comments" 15/700 · "Sort by" · "Add a comment..."
  │   └ ytd-comment-thread-renderer
  │     ├ ytd-comment-view-model        avatar 36 · author 12/18/500 · time 12/18/400
  │     │                               body 14/20/400 · toolbar 32 tall
  │     └ ytd-comment-replies-renderer
  │       └ ytd-comment-view-model      offset +48px · avatar 24 · body left +40px
  └ #secondary > #secondary-inner > #related > #contents   528 wide
    └ yt-lockup-view-model (horizontal)  528×185.63, 8px gap
        thumbnail 330×185.63 radius 12 · title 2-line clamp · "858K" · "2y ago"
```

## 11. What the screenshots are

`research/screenshots/` holds 30 PNG captures taken during this pass. **They are local visual
references for build agents to diff their work against. They are not licensed assets and must not be
redistributed, committed to a public artefact, or shipped in the product.** They contain third-party
thumbnails, channel avatars and video frames belonging to their creators. Delete them once the build
matches.

| File | Surface |
| --- | --- |
| `01-home-empty-state-1920.png` | logged-out cold-start home |
| `02-home-1920.png` | home, populated, 3-up grid |
| `04-nav-expanded-1920.png` / `05-nav-mini-1920.png` / `05b-nav-mini-detail-1920.png` | left nav, both states |
| `06-search-focused-empty-1920.png` / `07-search-suggestions-1920.png` | search field focused, dropdown open |
| `08-search-results-1920.png` / `22-search-no-results-1920.png` | results, and the "Did you mean" path |
| `09-watch-1920.png` / `10-watch-comments-1920.png` / `21-watch-metadata-1920.png` / `23-watch-description-expanded-1920.png` | watch page |
| `11-player-controls-1920.png` / `11b-…-detail` / `11c-…-nonad` | control bar visible |
| `12-player-progress-hover-1920.png` | scrub hover, preview tooltip |
| `13-player-settings-menu-1920.png` / `14-player-quality-submenu-1920.png` | player menus |
| `15-player-theatre-1920.png` / `16-player-fullscreen-1920.png` | theatre, fullscreen |
| `17-channel-home-1920.png` / `18-channel-videos-1920.png` | channel Home and Videos tabs |
| `19-shorts-1920.png` | `/shorts` |
| `20-home-dark-1920.png` | dark theme |
| `grid-{1920,1366,1280,1024,768,480}.png` | responsive grid ladder |

(`signedin-*.jpg` in that folder are from a different lane and are not part of this pass.)

Nothing else was downloaded: no logo files, no icon sprite sheets, no fonts, no thumbnails, no video.
Everything in `research/extracted/` is measurement — numbers, computed style strings and geometry.

## 12. Raw data index

| File | Contents |
| --- | --- |
| `tokens-yt-sys-color.json` | the 190 `--yt-sys-color-*` tokens, light + dark — **start here** |
| `tokens-light-and-dark.json` | all 930 resolved custom properties, both themes |
| `tokens-theme-diff.json` | the 350 that change between themes |
| `tokens-light-raw.json` | first pass, including the 117 minified `--t…` aliases |
| `theme-light-dark-hover-motion.json` | per-component computed colour in both themes, hover states, transition inventory |
| `home-1920.json` | masthead, guide, chip bar, grid and card measurements at 1920 |
| `card-dump-1920.json` | every descendant of one real (non-ad) card with box + type + colour |
| `dom-home-and-card.json` | annotated DOM outlines and outerHTML for card, grid, masthead, guide |
| `chips-and-miniguide.json` | chip internals selected vs unselected; mini-guide entry internals |
| `layout-responsive-and-nav.json` | the 11-width responsive sweep, guide entries and sections |
| `search-and-breakpoints.json` | pixel-exact breakpoints, focused search box, suggestions, results lockup |
| `watch-layout-1920.json` | watch page layout, metadata, comments, related — full element dumps |
| `watch-comments-formats.json` | comment/reply geometry, subscribe button, sidebar breakpoint, format samples |
| `player-1920.json` | control bar, progress, settings, quality, theatre, fullscreen |
| `player-chrome-and-sidebar.json` | delhi-modern pills, gradient disabled proof, compact sidebar lockup |
| `player-progress-colours.json` | progress colours plus the source CSS rules |
| `player-gradient-decoded.json` | the 1×198 PNG alpha ramp, decoded row by row |
| `channel-and-shorts.json` | channel header, tabs, videos grid, Shorts reel |
| `copy-and-formats.json` | exact copy strings, masthead detail, low-view-count samples |
| `icons-svg-paths.json` | 78 unique icons with viewBox and path data (brand marks removed) |
| `_probe-home.json` | first orientation pass: the 84 custom element names present on home, and the cold-start empty grid |
| `watch-sidebar-breakpoint.json` | **superseded** — a stub explaining a wrong measurement it used to hold, so the bad number cannot be quoted by mistake |

## 13. Known gaps

- **Sub-1,000 view formatting** was never observed logged-out; the abbreviation table's bottom row is
  an assumption, flagged in §8.1.
- **Chip hover colour** could not be isolated — the hover landed on the outer custom element, whose
  background stays transparent. Expected `--yt-sys-color-baseline--button-chip-background-hover`
  (`rgba(0,0,0,0.1)` light) on `.ytChipShapeChip`; unverified.
- **Volume slider geometry** measured 0 wide — it only expands on hover over the volume area, which
  this pass did not trigger.
- **Shorts action rail** returned empty labels; the reel overlay had not finished hydrating. Only the
  video box, aspect and text order are recorded.
- **Search "no results"** does not exist as a state on this surface (§8.3).
- The player was in compact mode at 1344px wide; the `--yt-delhi-*` defaults for a full-size player
  (72px bar, 48px pills, `backdrop-filter: blur(16px)`) are quoted from CSS but not measured.
