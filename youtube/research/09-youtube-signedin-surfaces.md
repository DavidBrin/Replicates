# R9 — YouTube signed-in surfaces

Measurements taken from a real signed-in session in Chrome on 2026-08-16. This lane
covers only the surfaces that **do not exist when logged out**; the logged-out
interface is R8's (`08-*`).

**Privacy note.** Everything below is geometry, computed style and structure. No
account identity, channel name, subscription list, watch history, video title or
playlist name appears here — where a real value was needed to describe a row it is
written as «placeholder». The screenshots that back these numbers are saved locally
as `research/screenshots/signedin-*` and are excluded by `youtube/.gitignore:25`.

---

## 0. Capture conditions

| | |
|---|---|
| Viewport | **1512 × 827** CSS px, `devicePixelRatio` 2 |
| Theme | dark (`<html dark>`), `--yt-sys-color-baseline--base-background` = `#0f0f0f` |
| Font stack | `Roboto, Arial, sans-serif` |
| Root font size | 10px (YouTube sets `html{font-size:10px}`, so `1.4rem` = 14px) |

R8 captures at 1920. **The pixel numbers here are not directly comparable to R8's**
because the grid column count is viewport-driven. What *is* portable is the token
set, the type roles and the per-component geometry — all recorded below.

---

## 1. The design-token system — `--yt-spec-*` is dead

This is the single most load-bearing finding for the replica.

Every YouTube reimplementation on the internet (and most older documentation)
targets `--yt-spec-text-primary`, `--yt-spec-base-background`, and friends. **That
namespace no longer exists in the shipped build.** Scanning every same-origin
stylesheet:

```
total CSS custom properties declared: 1469
  --yt-sys-*          259     ← the live design-token namespace
  --yt-live-*         150     (live chat)
  --yt-deprecated-*    67     ← where the old palette went
  --yt-formatted-*     32
  --paper-input-*      32     (Polymer legacy)
  --ytd-watch-*        28
  --ytd-rich-*         19
  --yt-button-*        16
  ...
  --yt-spec-*           1     ← and it resolves to nothing
```

Build against `--yt-sys-*`. The old `--yt-spec-*` names are gone, and the literal
palette hexes that used to live behind them are now under `--yt-deprecated-*`
(`--yt-deprecated-black-1` = `#282828`, `-black-2` = `#1f1f1f`, `-black-3` =
`#161616`, `-black-4` = `#0d0d0d`).

### 1.1 `--yt-sys-measurement--*` — the numeric scales

These are the whole app's spacing/sizing vocabulary. Named t-shirt steps, not a
4px/8px ladder — the names recur across every component.

**Radius** (`--yt-sys-measurement--radius-*`)

| min | condensed | compact | cozy | comfortable | expanded | prominent | hero | huge | max |
|---|---|---|---|---|---|---|---|---|---|
| 2px | 4px | 8px | 12px | 16px | 18px | 20px | 24px | 32px | 48px |

**Generic size** (`--yt-sys-measurement--size-*`)

| hairline | min | tiny | mini | condensed | compact | cozy | comfortable | expanded | prominent | hero | legend | huge |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1px | 4px | 6px | 8px | 12px | 16px | 18px | 24px | 32px | 36px | 40px | 48px | 56px |

**Avatar** (`--yt-sys-measurement--avatar-size-*`)

| mini | condensed | compact | cozy | comfortable | expanded | prominent | hero | legend | huge | max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 16px | 24px | 32px | 36px | 40px | 48px | 56px | 72px | 120px | 144px | 160px |

**Icon** (`--yt-sys-measurement--icon-size-*`)

| mini | condensed / standard | compact | cozy | comfortable | expanded | prominent | hero |
|---|---|---|---|---|---|---|---|
| 12px | 16px | 18px | 20px | 24px | 36px | 40px | 48px |

**Action (button) height** (`--yt-sys-measurement--action-height-*`)

| tiny | compact | standard | prominent | hero |
|---|---|---|---|---|
| 24px | 32px | 36px | 48px | 56px |

**Stroke** — `cozy` 0.5px, `comfortable` 1px, `expanded` 2px.

**Feed / shelf layout**

```
--yt-sys-measurement--feed-col-gap-{small,med,wide}   =  8px / 12px / 16px
--yt-sys-measurement--feed-row-gap-{small,med,wide}   =  8px / 12px / 16px
--yt-sys-measurement--feed-margin-{small,med,wide}    =  0px / 16px / 16px
--yt-sys-measurement--feed-max-width-{med,wide}       = 840px / 1024px
--yt-sys-measurement--shelf-item-gap-{small,med,wide} = 12px / 16px / 16px
--yt-sys-measurement--shelf-peek-{small,med,wide}     = 24px / 48px / 64px
```

### 1.2 `--yt-sys-color-baseline--*` — the semantic palette (dark theme resolved)

Surfaces
```
base-background            #0f0f0f      raised-background          #212121
menu-background            #282828      solid-background           #e6e6e6
inverted-background        #f1f1f1      inverted-background-hover  #d9d9d9
frosted-glass-desktop      rgba(15,15,15,0.8)
frosted-glass-mobile       rgba(15,15,15,0.7)
```

Text
```
text-primary               #f1f1f1      text-primary-inverse       #0f0f0f
text-secondary             #aaa         text-secondary-inverse     #606060
text-disabled              #717171      text-disabled-inverse      #909090
text-error                 #ffbfbd
overlay-text-primary       #fff         overlay-text-secondary     rgba(255,255,255,0.7)
overlay-text-disabled      rgba(255,255,255,0.3)
```

Tonal / additive fills (this is what every "tonal" button and chip uses)
```
additive-background        rgba(255,255,255,0.1)
tonal-background           rgba(255,255,255,0.1)
tonal-rim                  rgba(255,255,255,0.1)
tonal-wash                 rgba(255,255,255,0.05)
button-chip-background-hover rgba(255,255,255,0.2)
mono-filled-hover          #d9d9d9
```

Outlines
```
outline                    rgba(255,255,255,0.2)     outline-opaque   #3f3f3f
outline-rim                rgba(255,255,255,0.15)    outline-wash     rgba(0,0,0,0)
outline-inverse            rgba(0,0,0,0.1)           outline-inverse-opaque #e5e5e5
```

Overlays (thumbnail scrims, badges, immersive headers)
```
overlay-background-extra-light  rgba(0,0,0,0.03)
overlay-background-light        rgba(0,0,0,0.1)
overlay-background-medium-light rgba(0,0,0,0.3)
overlay-background-medium-heavy rgba(0,0,0,0.4)
overlay-background-medium       rgba(0,0,0,0.6)   ← duration badge
overlay-background-heavy        rgba(0,0,0,0.8)
overlay-background-solid        #000
overlay-background-brand        rgba(225,0,45,0.9)
overlay-additive-background     rgba(40,40,40,0.6)
overlay-tonal-background        rgba(255,255,255,0.3)
overlay-solid-background        #e6e6e6
overlay-outline-rim             rgba(255,255,255,0.15)
themed-overlay-background       rgba(0,0,0,0.8)
```

Accents / status
```
call-to-action             #3ea6ff   ← every blue link, "View all", the guide's new-video dot
call-to-action-hover       #65b8ff
call-to-action-inverse     #065fd4   ← the light-theme blue
brand-red-contrast         #f57
red-indicator              #e1002d
error-indicator            #f57      error-indicator-inverse  #c30027
error-background-red       rgba(255,85,119,0.2)
themed-green               #2ba640   themed-green-inverse     #107516
icon-warning               #fbc02d   static-ad-yellow         #fbc02d
suggested-action           #263850   suggested-action-hover   #515561
suggested-action-inverse   #def1ff
wordmark-text              #fff
shadow-medium              rgba(0,0,0,0.25)
```

Interaction states — these are the ripple/hover layers, applied as separate
absolutely-positioned divs rather than as `:hover` background changes:
```
state-mono-standard-hovered     rgba(255,255,255,0.05)
state-mono-standard-pressed     rgba(255,255,255,0.1)
state-mono-filled-hovered       rgba(0,0,0,0.05)
state-mono-filled-pressed       rgba(0,0,0,0.1)
state-overlay-filled-hovered    rgba(0,0,0,0.2)
state-overlay-filled-pressed    rgba(0,0,0,0.3)
state-overlay-standard-hovered  rgba(255,255,255,0.05)
touch-response                  #fff      touch-response-inverse  #000
```

Static (never theme-flip)
```
static-white-background #fff   static-dark-grey #333   static-grey #606060
static-magenta #ff2791         static-medium-magenta #e01378
```

---

## 2. Shared primitives — the "Shapes" component layer

Modern YouTube renders almost every interactive atom through a small set of
`*-shape` / `*-view-model` custom elements with BEM-ish global classnames (no
`style-scope` prefix). Reproducing these four gets you most of the signed-in UI.

### 2.1 `ytSpecButtonShapeNext` — the universal button

Class grammar observed on real buttons:

```
ytSpecButtonShapeNextHost
  ytSpecButtonShapeNextFilled | ytSpecButtonShapeNextTonal | ytSpecButtonShapeNextText
  ytSpecButtonShapeNextMono   | ytSpecButtonShapeNextOverlay
  ytSpecButtonShapeNextSizeS | SizeM | SizeL | SizeXl
  [ IconLeading | IconButton | IconOnlyDefault | IconLeadingTrailing
  | IconLeadingTrailingNoText | SegmentedStart | SegmentedEnd
  | DisableTextEllipsis ]
  ytSpecButtonShapeNextEnableBackdropFilterExperiment
```

Measured size ladder (all `display:flex`, all Roboto, weight 500):

| size | height | radius | font / line-height | text padding | icon-only footprint |
|---|---|---|---|---|---|
| `SizeS` | 32px | 16px | 12px / 32px | `0 12px` | 32 × 32 |
| `SizeM` | 40px | 20px | 14px / 40px | `0 16px` | 40 × 40 (r 20 / 50%) |
| `SizeL` | 48px | 24px | 18px / 48px | — | 48 × 48 (r 24) |
| `SizeXl` | 56px | 28px | 24px / 56px | — | 56 × 56 (r 28) |

Colour by variant × palette:

| | Mono (default surface) | Overlay (on artwork/video) |
|---|---|---|
| `Filled` | bg `#f1f1f1`, text `#0f0f0f` | bg `#fff`, text `#000` |
| `Tonal` | bg `rgba(255,255,255,0.1)`, text `#f1f1f1` | bg `rgba(255,255,255,0.1)`, text `#fff` |
| `Text` | transparent, text `#f1f1f1` | transparent, text `#fff` |

Outlined variant (used for shelf "View all"/carousel arrows on the You page) is a
`Text` button plus `border: 1px solid rgba(255,255,255,0.2)` and `padding: 0 15px`
(15, not 16 — the border eats a pixel). Its disabled colour is `#717171`.

Internal DOM of every button — worth copying, it's how the hover/press states work:

```
button.ytSpecButtonShapeNextHost …
  div.ytSpecButtonShapeNextButtonTextContent      ← label wrapper
    span.ytAttributedStringHost.ytAttributedStringWhiteSpaceNoWrap
  yt-touch-feedback-shape.ytSpecTouchFeedbackShapeHost
    div.ytSpecTouchFeedbackShapeStroke            ← 1px solid #fff, opacity 0
    div.ytSpecTouchFeedbackShapeFill              ← bg #fff, opacity 0
  div.contribYtLightShapeStaticWashLight…Tonal    ← rgba(255,255,255,0.05) wash
```

Studio has a **separate, parallel** implementation: `ytcpButtonShapeImplHost` with
modifiers `ytcpButtonShapeImpl--filled`, `--mono`, `--size-m`,
`--enable-backdrop-filter-experiment`. Same visual language, different classnames,
36px height instead of 40.

### 2.2 `chip-shape` — filter chips

```
yt-chip-cloud-chip-renderer
  div > chip-shape.ytChipShapeHost
    button.ytChipShapeButtonReset
      div.ytChipShapeChip.ytChipShapeActive|ytChipShapeInactive
          .ytChipShapeOnlyTextPadding
        div                                   ← label
        yt-touch-feedback-shape…
```

| | value |
|---|---|
| Height | 32px |
| Radius | **8px** (not a pill) |
| Padding | `0 12px` |
| Type | 14px / 20px, weight 500 |
| Active | bg `#f1f1f1`, text `#0f0f0f` |
| Inactive | bg `rgba(255,255,255,0.1)`, text `#f1f1f1` |
| Gap — home feed filter bar | **12px** (`margin: 12px 12px 12px 0`), bar 56px tall |
| Gap — chip-cloud (history, playlists) | **8px** |

A chip with a trailing chevron (sort chips) uses `padding: 0 0 0 12px` and lets the
icon supply the right inset.

### 2.3 `yt-lockup-view-model` — the universal card

Every video/playlist/channel card on every signed-in surface is now one component.
Host modifier classes select the layout:

```
ytLockupViewModelHost
  ytLockupViewModelVertical | ytLockupViewModelHorizontal
  [ ytLockupViewModelCollectionStack2 ]     ← playlists (stacked card)
  [ ytLockupViewModelCompact ]
  [ ytLockupViewModelRichGridLegacyMargin ]
  [ ytLockupViewModelFlexNone ]
  content-id-«videoId»                      ← per-item id class
```

Annotated skeleton (numbers are the home-feed vertical case at 1512px):

```
ytd-rich-item-renderer                        397.3 × 323.5   margin 0 8px 32px
  yt-lockup-view-model
    div.ytLockupViewModelHost.ytLockupViewModelVertical
      yt-touch-feedback-shape…                (hover ring, 421×347 — overflows by 12/8)
      a.ytLockupViewModelContentImage         397.3 × 235.5   padding-bottom 12px
        yt-thumbnail-view-model               397.3 × 223.5   radius 12px   16:9
          div.ytThumbnailViewModelImage
            img.ytCoreImageHost.ytCoreImageFillParentWidth/Height
          yt-thumbnail-bottom-overlay-view-model      397.3 × 28
            div…BadgeContainer…Large                   50 × 28
              yt-thumbnail-badge-view-model
                badge-shape.ytBadgeShapeThumbnailBadge 38.5 × 20
                    radius 4px  bg rgba(0,0,0,0.6)  12px/18px w500  #fff  padding 1px 4px
      div.ytLockupViewModelMetadata           397.3 × 88
        yt-lockup-metadata-view-model…Vertical…Standard
          yt-avatar-shape                      36 × 36        (avatar-size-cozy)
          div.ytLockupMetadataViewModelTextContainer  349.3 × 88   (starts x+48)
            h3.ytLockupMetadataViewModelHeadingReset  349.3 × 44
              a.ytLockupMetadataViewModelTitle        padding-right 24px
                span.ytAttributedStringHost           16px/22px w500  #f1f1f1  2 lines
            div.ytLockupMetadataViewModelMetadata     349.3 × 44
              yt-content-metadata-view-model.ytContentMetadataViewModelMediumText
                div.ytContentMetadataViewModelMetadataRow   349.3 × 20  margin-top 2px
                  span.ytAttributedStringHost         14px/20px w400  #aaa   ← channel
                div.ytContentMetadataViewModelMetadataRow   349.3 × 20  margin-top 2px
                  span.ytAttributedStringHost         ← views
                  span.ytContentMetadataViewModelDelimiter  ← the "•"
                  span.ytAttributedStringHost         ← relative date
          div.ytLockupMetadataViewModelMenuButton  40 × 40
            button …IconButton  radius 20px
```

The **horizontal** variant (watch history, search-style rows) keeps the same tree
and changes only: thumbnail radius **8px** (not 12), `contentImage` gets
`padding-right: 16px`, title collapses to a single 22px line, and the metadata
rows use **12px / 18px** instead of 14/20.

### 2.4 `yt-collection-thumbnail-view-model` — the playlist "stack"

```
yt-collection-thumbnail-view-model
  yt-collections-stack.ytCollectionsStackHost
    div.ytCollectionsStackSpacer            height 5px (small) — the peek gap
    div.ytCollectionsStackRelativeStack
      div.ytCollectionsStackCollectionStack1[…Small]
              inset behind, radius 4px, background = colour sampled from the art,
              margin-top -1px
      yt-thumbnail-view-model               ← the front thumbnail, radius 12px
```

At playlist-grid size the front thumb is 294 × 166.4 and the peeking layer 40 ×
33.5; in the Save sheet (56px lead image) the front thumb is 56 × 32.5 and the peek
layer 40 × 33.5 with a 5px spacer. The count badge sits bottom-right: 20px tall,
radius 4px, `12px/18px w500` white, background is a **desaturated sample of the
artwork at ~80% alpha** (observed `rgba(35,39,51,0.8)`), not a fixed black.

---

## 3. Signed-in chrome (masthead + guide)

### 3.1 Masthead — 56px

```
#masthead                                1512 × 56
  #container.ytd-masthead                padding 0 16px, flex
    #start    hamburger 40×40 + logo
    #center                              732 × 48  @ x=362
    #end                                 225 × 40  @ x=1271
      #buttons                           207.2 × 40 @ x=1289
        Create button    97.2 × 40  r20  bg rgba(255,255,255,0.1)  14px/40 w500
                                          padding 0 16px  (Tonal Mono SizeM IconLeading)
        Notifications    40 × 40   icon button @ x=1394
        Avatar button    54 × 34   padding 1px 0 1px 6px @ x=1442
          img            32 × 32   @ x=1456
```

Logged-out this cluster is a single "Sign in" outline button, so the whole
`#buttons` group is signed-in-only. The 32px avatar is `avatar-size-compact`.

### 3.2 Guide (left rail) — 240px

```
tp-yt-app-drawer#guide                   240 × (viewport − 56)  @ y=56
  #guide-inner-content                   240 wide
    ytd-guide-section-renderer           padding 12px           (× 6 sections)
      ytd-guide-entry-renderer           204 × 40  radius 10px  (12px side inset)
        yt-icon.guide-icon               24 × 24   margin-right 24px  → label x = +60
        yt-formatted-string.title        14px / 20px   #f1f1f1
                                         weight 500 when selected, 400 otherwise
        (selected) background            rgba(255,255,255,0.1)
```

Signed-in-only pieces:

* **Collapsible section headers** ("Subscriptions", "You") are
  `ytd-guide-collapsible-section-entry-renderer > #header-entry` — an *entry*, not a
  heading: same 204 × 40 / radius 10px box, but the label is **16px / 22px w500**
  with `padding-right: 8px` and a **16 × 16 trailing chevron**. The whole row is a
  link to `/feed/subscriptions` / `/feed/you`.
* **Subscription rows** replace the 24px icon with a 24 × 24 round channel avatar and
  drop the label to weight 400.
* **New-video dot**: a `div` **4 × 4**, `border-radius: 50%`, background
  `#3ea6ff` (= `call-to-action`), positioned 18px in from the entry's right edge
  (x = 194 within a 12→216 entry).
* A "Show more" collapsible entry closes the subscription list (label weight 400).
* Non-collapsible section titles further down (Explore / More from YouTube) use
  `#guide-section-title`: 216 × 32, **16px / 22px w500**, `padding: 6px 12px 4px`.

---

## 4. Signed-in home feed

Structurally identical to logged-out, with two additions: the chip bar carries
personalised topic chips, and the grid is a recommendation feed rather than a
trending fallback.

**Chip / filter bar** — `ytd-feed-filter-chip-bar-renderer`, 1272 × **56**, flex,
sitting directly above the grid at y = 56.

* 21 chips in this session. Chip 0 is always the selected "All" (3 chars). The rest
  mix **fixed verticals** — the generic set is Gaming, Music, News, Podcasts, Live,
  Mixes, Playlists — with **personalised topic chips derived from watch history**
  (in this session 14 of 21 were personalised: topic nouns 4–17 characters). A
  replica should model the chip set as `["All", ...pinnedVerticals, ...derivedTopics]`
  and expect 15–25 chips with an overflow chevron on the right.
* Geometry per §2.2: 32px tall, radius 8px, `0 12px` padding, 12px gap, first chip
  at x = 264 (guide 240 + 24 page inset).

**Grid** — `ytd-rich-grid-renderer` 1272 wide at x = 240.

```
--ytd-rich-grid-items-per-row     3          (4 on the playlists index)
--ytd-rich-grid-item-margin       16px
--ytd-rich-grid-item-max-width    700px
--ytd-rich-grid-item-min-width    326.8px
--ytd-rich-grid-gutter-margin     16px
--ytd-rich-grid-row-margin        32px
--ytd-rich-grid-content-max-width calc(3*(700px + 16px) - 16px)
```

Items are laid out as `width: calc(33.3333% - 16px); margin: 0 8px 32px` — a
flex-wrap grid, **not** CSS Grid, and **not** `ytd-rich-grid-row` (0 row elements;
99 items sit flat under `#contents` alongside `ytd-rich-section-renderer` shelves
and a trailing `ytd-continuation-item-renderer`). Columns are derived from
`item-min-width` 326.8px: at 1512 the content box is 1272 → 3 columns.

Card anatomy: §2.3.

---

## 5. Subscriptions feed (`/feed/subscriptions`)

**Two long-standing assumptions are wrong in the current build:**

1. **There are no per-day section headers.** No "Today" / "This week" / "This month"
   grouping anywhere in the feed. The chronological list is a flat rich grid of 99+
   items with continuation loading.
2. **There is no grid/list view toggle**, and there is no "Manage" button. The
   manage affordance is now a pill labelled **"All subscriptions"** at the top-right
   linking to `/feed/channels`.

Page composition, top to bottom:

```
ytd-rich-grid-renderer #contents
├─ ytd-rich-section-renderer > ytd-shelf-renderer          1240 × 68
│     #title  "Latest"      20px / 28px  w700   @ x=264
│     .grid-subheader                            margin-top 24px
│     ytd-button-renderer → a  136.8 × 40  r20  padding 0 16px
│           bg rgba(255,255,255,0.1)  14px/40 w500   href=/feed/channels
├─ ytd-rich-section-renderer > ytd-rich-shelf-renderer     1240 × 450.5
│     #title  "Most relevant"  20px / 28px w700  @ x=272
│     elements-per-row = 3
│     #contents  padding 12px 0 ; margin 0 -8px -12px
│     "Show more" expander  360 × 40  r20  (Text Mono, trailing chevron)
├─ ytd-rich-section-renderer > ytd-rich-shelf-renderer[is-shorts]   1240 × 565.5
│     header 1216 × 40  margin 0 0 16px 8px
│       Shorts glyph 24 × 24  margin-right 8px
│       #title 20px / 28px w700
│       "View all" link  80.7 × 40  r20  padding 0 16px  colour #3ea6ff
│     elements-per-row = 5
│     "Show more" expander
├─ ytd-rich-item-renderer × N          ← flat chronological grid, 3 per row
└─ ytd-continuation-item-renderer
```

Shelf attribute surface worth mirroring: `elements-per-row`, `is-shorts`,
`show-bottom-divider`, `restrict-contents-overflow`, `has-expansion-button`.

### 5.1 Shorts card — `ytm-shorts-lockup-view-model-v2`

| | subscriptions shelf (5-up) | history reel shelf |
|---|---|---|
| Card | 232 × 426.5 | 214 × 393.5 (padding-right 4px) |
| Thumbnail | 232 × 348 — **2 : 3**, not 9 : 16 | 210 × 315 |
| Title `h3` | 16px / 22px w500, 2 lines (44px), margin-bottom 4px | same |
| Views subhead | 14px / 20px w400 `#aaa` | same |
| Overflow menu | 40 × 40, radius 20px | same |

### 5.2 All subscriptions (`/feed/channels`)

```
yt-page-header-view-model        928 × 78   bg #0f0f0f   padding 24px 0 4px
  h1                             36px / 50px  w700
sort chip (chip-cloud)           32px  r8   padding 0 0 0 12px + trailing chevron
ytd-section-list-renderer        1024 wide  padding 0 48px   → content column 928 @ x=412

ytd-channel-renderer             928 × 136   margin-bottom 16px
  #avatar-section                136 × 136   margin-right 16px
    yt-img-shadow > img          136 × 136   border-radius 50%   (source 176px)
  #info-section                  776 wide  @ x=564  (avatar + 16px)
    #title            «channel name»   18px / 26px  w400  #f1f1f1
    #subscribers      «@handle • N subscribers»   12px / 18px  w400  #aaa
    #description      12px / 18px  w400  #aaa   2 lines (36px)
  Subscribed button   102.4 × 40  r20  Tonal Mono SizeM  @ x=1190
                      (bell glyph + label; unsubscribing is a menu inside it)
```

---

## 6. Watch history (`/feed/history`)

Two-column with a **persistent right rail** — the only browse page that uses one.

```
ytd-two-column-browse-results-renderer      1070 wide @ x=341
  #primary     1070 × …   padding-right 441px
  #secondary    441 × 827  @ x=1071          ← sticky controls rail
```

**Primary column**

```
yt-page-header-view-model  h1        36px / 50px  w700       "Watch history"
chip cloud (5 chips)                 32px  r8   8px gap
        All(3) · Videos(6) · Shorts(6) · Podcasts(8) · Music(5)
        chip 0 active: bg #f1f1f1 / text #0f0f0f

ytd-item-section-renderer            ← ONE PER DAY  (4 sections loaded)
  #title   day label                 20px / 28px  w700  padding 24px 0 8px
                                     («Today», «Yesterday», then a date)
  ├─ ytd-reel-shelf-renderer         629 × 486.5      ← that day's Shorts, if any
  │    Shorts glyph 24 × 24 (margin-right 8px) + #title 20px/28px w700
  │    ytd-menu-renderer overflow 40 × 40
  │    horizontal carousel, right-arrow circular button on hover
  │    cards 214 × 393.5 (§5.1)
  └─ yt-lockup-view-model (horizontal) × N            ← that day's watched videos
```

**History row** — the canonical horizontal lockup:

```
yt-lockup-view-model.ytLockupViewModelHorizontal     629 × 138.4   margin-top 16px
  a.ytLockupViewModelContentImage      262 × 138.4   padding-right 16px
    yt-thumbnail-view-model            246 × 138.4   radius 8px      (16:9)
      badge-shape (duration)            38.5 × 20    r4  rgba(0,0,0,0.6)  12px/18px w500
  div.ytLockupViewModelMetadata        367 × 138.4  @ x=603
    a.ytLockupMetadataViewModelTitle   «video title»  16px / 22px  w500  #f1f1f1
                                       padding-right 24px, single line
    div…MetadataRow                    padding 8px 0 ; margin-top 2px
      span  «channel • views»          12px / 18px  w400  #aaa
  div.ytLockupMetadataViewModelMenuButton  40 × 40  r20   (top-right of the row)
```

**Right rail** (`#secondary`, 441 wide, contents inset to a 353px column at x=1115)

```
ytd-search-box-renderer          353 × 56   margin 4px 16px 8px
  leading search icon button     40 × 40    radius 50%   (Text Mono IconOnly)
  input  «Search watch history»  14px / 20px  w400  letter-spacing 0.2px
  (a 1px bottom rule under the field, not a boxed input)

ytd-browse-feed-actions-renderer          ← 40px-tall Text/Mono icon-leading pills,
                                             radius 20px, padding 0 16px, 56px pitch
  y=226   «Clear all watch history»   194.5 × 40
  y=282   «Pause watch history»       182.5 × 40
  y=338   «Manage all history»        171.1 × 40

ytd-compact-link-renderer × 3             ← indented sub-links under "Manage"
  353 × 40   margin-left 32px   label 14px / 20px  w400  @ x=1147
  «Comments» · «Posts» · «Live chat»
```

Note the three action buttons are **`Text` + `Mono`**, i.e. transparent with a
leading 24px icon — not tonal pills. The indent on the sub-links is a plain
`margin-left: 32px`, with no connecting rule.

---

## 7. The "You" page (`/feed/you`)

A profile header plus four horizontal shelves. No feed, no chips.

```
yt-page-header-view-model              1224 × 124  @ x=264, y=56
  avatar                               120 × 120   (avatar-size-legend)
  h1 «display name»                    36px / 50px  w700   @ x=400  (avatar + 16px)
  yt-content-metadata-view-model       «@handle • View channel»
     span                              14px / 20px  w400  #aaa
  two buttons, SizeS Tonal Mono IconLeading
     122.3 × 32   radius 16px   12px / 32px  w500   padding 0 12px
     «Switch account» · «Google Account»
```

Shelves — all `ytd-rich-section-renderer > ytd-rich-shelf-renderer`, `elements-per-row = 4`:

| # | shelf | height | item type |
|---|---|---|---|
| 1 | History | 369.4 | video lockups (mixed with Shorts, badged `SHORTS`) |
| 2 | Playlists | 369.4 | playlist lockups (collection stack) |
| 3 | Watch later | 375.4 | video lockups |
| 4 | Liked videos | 375.4 | video lockups |

Shelf header:

```
#title        20px / 28px  w700   @ x=272
subtitle      «N videos»          (a second line under the title, shelves 3–4)
"View all"    a  80.7 × 40  radius 20px  padding 0 15px
              border 1px solid rgba(255,255,255,0.2)   @ x=1311
prev / next   button 40 × 40  radius 20px  same 1px border   @ x=1394 / x=1442
              disabled colour #717171
Playlists shelf only: an extra "+" icon button (new playlist) left of "View all"
```

Sections are 369–375px tall on a 372–376px vertical pitch.

---

## 8. Playlists

### 8.1 Index (`/feed/playlists`)

```
h1                                       36px / 50px  w700
chip cloud, 4 chips   («Recently added»(14) · Playlists(9) · Music(5) · Owned(5))
     chip 0 selected but rendered INACTIVE-styled (tonal) with a trailing chevron —
     it is a sort chip, not a filter chip
ytd-rich-grid-renderer  --ytd-rich-grid-items-per-row = 4

yt-lockup-view-model                     294 × 265.4
  host: …Vertical …CollectionStack2 …Compact …RichGridLegacyMargin …FlexNone
  yt-collection-thumbnail-view-model     294 × 165.4     (§2.4)
    front thumbnail                      294 × 166.4  radius 12px  margin-top -1px
  badge-shape (item count)               75.8 × 20  r4  12px/18px w500 #fff
                                         bg = artwork-sampled  rgba(…,0.8)
  a.ytLockupMetadataViewModelTitle       «playlist name»  16px / 22px  w500
  3 × MetadataRow  22px pitch  margin-top 2px  14px / 20px  w400  #aaa
     row 0  «Private|Public|Unlisted • Playlist»
     row 1  «Updated N days ago»            (owned playlists only)
     row 2  «View full playlist»
```

### 8.2 Detail page + sidebar panel (measured on Watch Later, `?list=WL`)

The playlist page inverts the usual layout: a **sticky immersive panel on the left**
and the video list on the right.

```
ytd-browse[page-subtype=playlist]     padding-top 24px
ytd-two-column-browse-results-renderer   padding-LEFT 388px
  #primary   884 wide @ x=628           ← the video list
  #secondary 0 wide                     ← unused on this page

ytd-playlist-header-renderer          360 × 747   margin-left 24px   (position: sticky)
  .immersive-header-container         360 × 723   radius 16px  padding 24px
                                      margin-bottom 24px
      background: a colour/gradient sampled from the playlist artwork
      colour: #fff  → the whole panel uses the OVERLAY palette
    playlist artwork thumbnail        312 wide (the panel's content box)
    yt-dynamic-sizing-formatted-string  «playlist name»   312 wide, auto-shrinking
    owner link                        14px / 20px  w500  #fff
    stats line                        12px / 18px  w400  rgba(255,255,255,0.7)
                                      «N videos · No views · Updated N days ago»
    icon button (overflow)            40 × 40  r20  Tonal Overlay SizeM IconButton
    "Play all"   a  152 × 40  r20  padding 0 16px  Filled Overlay SizeM IconLeading
                                    bg #fff, text #000
    "Shuffle"    a  152 × 40  r20  Tonal Overlay SizeM IconLeading
                                    bg rgba(255,255,255,0.1), text #fff
                 → 8px gap between the two
```

**Video list rows** — a distinct renderer (`ytd-playlist-video-renderer`, *not* a
lockup), because it carries an index and a drag handle:

```
ytd-playlist-video-renderer           860 × 129   radius 12px   @ x=628
  #index-container                     36 wide     (index number; on hover it
                                                    swaps for a 36 × 24 drag handle,
                                                    padding 0 6px)
  ytd-thumbnail                       200 × 113   margin-right 8px
    duration overlay                   35.6 × 20  margin 4px
  #video-title                        «title»  16px / 22px  w500  2 lines (44px)
                                      margin-bottom 8px   @ x=872
  metadata line                       «channel • views • date»  12px / 18px w400 #aaa
  ytd-menu-renderer                    40 × 40   @ right edge
```

Watch Later is the same renderer as any other playlist — the only differences are
the fixed name, the `Private` privacy label, and that it is not deletable.

---

## 9. Watch page as a signed-in user

Everything below the player. `#above-the-fold` is 1048.2 wide at x = 16.

```
h1 (video title)                      20px / 28px  w700  #f1f1f1

#owner                                287 × 42.5   margin 12px 32px 0 0
  avatar                              40 × 40                       (avatar-size-comfortable)
  ytd-channel-name #text              «channel»  16px / 22px  w500  @ x=68  (avatar+12)
  #owner-sub-count                    «N subscribers»  12px / 18px  w400  #aaa
  #subscribe-button                   74 × 40 when SUBSCRIBED
```

### 9.1 Subscribe button — subscribed state

Two buttons live in the slot; visibility switches on state.

| state | button | size | classes |
|---|---|---|---|
| not subscribed | text pill «Subscribe» | 102.4 × 40, r20, padding 0 16px | `Filled Mono SizeM` |
| **subscribed** | **bell + chevron pill, no text** | **74 × 40**, r20, padding 0 16px | `Tonal Mono SizeM IconLeadingTrailing IconLeadingTrailingNoText` |
| (alt subscribed) | «Subscribed» text pill | 102.4 × 40 | `Tonal Mono SizeM` |

So in the current build the subscribed affordance **collapses to an icon-only
notification pill** — the bell is the leading icon, the chevron is the trailing
icon, and `IconLeadingTrailingNoText` removes the label. Clicking it opens the
notification-level menu (All / Personalised / None / Unsubscribe). `aria-label`
carries the full 32-character description.

### 9.2 Action row

All at y ≈ 709, all `SizeM` (40px tall, radius 20px, padding `0 16px`,
14px / 40px w500), all **8px apart**:

```
x=551  ┌ segmented-like-dislike-button-view-model            144.7 × 40
       │   like     88.7 × 40  radius 20px 0 0 20px  Tonal Mono SizeM
       │                       IconLeading SegmentedStart
       │                       icon 24 × 24, margin 0 6px 0 -6px, then the count
       │   dislike  56 × 40    radius 0 20px 20px 0   IconButton SegmentedEnd
       └   (no gap and no visible divider between the halves — the two
            radii and a 0.3px seam do the separating)
x=704    Share       92 × 40   Tonal Mono SizeM IconLeading
x=804    Save        86 × 40   Tonal Mono SizeM IconLeading
x=898    Download   118 × 40   Tonal Mono SizeM IconLeading
x=1024   overflow    40 × 40   Tonal Mono SizeM IconButton
```

Logged out, Save and Download are absent and the dislike count is hidden; the
segmented pill itself exists in both states.

### 9.3 Save-to-playlist — a contextual **sheet**, not a modal dialog

Anchored to the Save button (opens at the button's x, above/below as space allows),
**not** centre-screen, **no scrim**.

```
tp-yt-iron-dropdown
  yt-sheet-view-model.ytSheetViewModelHost.ytSheetViewModelContextual
        400 × 333   radius 12px   box-shadow rgba(0,0,0,0.1) 0 4px 32px
    yt-contextual-sheet-layout
      div.ytContextualSheetLayoutHeaderContainer          400 × 48
        yt-panel-header-view-model…HideDivider
          h2.ytPanelHeaderViewModelTitleHeader…NonInteractive
            span.ytPanelHeaderViewModelTitle   «Save to…»  18px / 26px  w700  @16px inset
      div.ytContextualSheetLayoutContentContainer         400 × 220 (scrolls)
        toggleable-list-item-view-model × N
          yt-list-item-view-model                         400 × 54
            div.ytListItemViewModelLayoutWrapper…HasSubtitle   padding 6px 16px
              div.ytListItemViewModelImageContainer…Leading    56 × 42  margin-right 12px
                 yt-collection-thumbnail-view-model  56 × 36    (§2.4)
              div.ytListItemViewModelMainContainer            368 × 42
                 span.ytListItemViewModelTitle     «playlist»  14px / 20px  w400  #f1f1f1
                 span.ytListItemViewModelSubtitle  «Private»   12px / 18px  w400  #aaa
              trailing toggle icon                24 × 24  @ 16px from the right
                 (a bookmark glyph that fills when saved — NOT a checkbox)
      div.ytContextualSheetLayoutFooterContainer          400 × 65
        «New playlist»  button  376 × 40  r20  Tonal Mono SizeM IconLeading
```

Row pitch is a flat 54px. The old checkbox + "Cancel/Save" footer is gone.

### 9.4 Comments header and composer

```
ytd-comments-header-renderer
  #count   «31,485 Comments»       20px / 28px  w700  #f1f1f1  @ x=16
  #sort-menu trigger «Sort by»     16px / 22px  w400  #aaa     @ x=213
                                   (with a leading 24px sort glyph)

ytd-comment-simplebox-renderer                        1048.2 × 25   @ y=180
  #author-thumbnail img            24 × 24   round      ← the real signed-in avatar
                                             (avatar-size-condensed, NOT 40px)
  #placeholder-area                996.2 × 25  @ x=52   (avatar + 12px)
       padding-bottom 4px
       border-bottom 1px solid rgba(255,255,255,0.2)   ← 996px rule, full column
  #simplebox-placeholder «Add a comment…»   14px / 20px  w400  #aaa
```

The composer is collapsed to a single underlined line until focused; the avatar is
**24px**, notably smaller than the 40px avatar in the reply composer inside a thread.

**Comment thread** (for the row the composer sits above):

```
ytd-comment-thread-renderer            1048.2 × …   margin-bottom 16px
  #author-thumbnail column              36 wide   margin-right 16px
  #author-text   «@handle»              12px / 18px  w500  #f1f1f1  margin-right 4px
  .published-time-text «1 day ago»      12px / 18px  w400  #aaa    @ x=146
  #content-text                         14px / 20px  w400  #f1f1f1 @ x=68
  #toolbar                              margin-top 4px
    like button                          32 × 32  radius 16px
    #vote-count-middle                   12px / 18px  w400  #aaa  margin-right 8px
    dislike button                       32 × 32  radius 16px
    "Reply"  text button                 32px tall  radius 16px  padding 0 12px
  "N replies" expander                   40px tall  radius 20px  padding 0 16px
                                         colour #3ea6ff
```

---

## 10. Account menu (avatar → dropdown)

```
tp-yt-iron-dropdown                        300 × 749  @ x=1196, y=53
  ytd-multi-page-menu-renderer             300 wide
      background #282828 (menu-background)   radius 12px
    ytd-active-account-header-renderer     300 × 105
      avatar img            40 × 40   @ 16px inset
      #account-name   «display name»   16px / 22px  w400  #f1f1f1  @ x=1268 (56px inset)
      #channel-handle «@handle»        16px / 22px  w400
      "View your channel" link         14px / 20px  margin-top 8px  colour #3ea6ff
    yt-multi-page-menu-section-renderer × 5     padding 8px 0
      ytd-compact-link-renderer × 13     300 × 40 each
        yt-icon                  24 × 24  @ 16px inset
        title                    14px / 20px  w400  #f1f1f1  @ x=1252 (56px inset)
        submenu chevron          24 × 24  right-aligned, margin-left 8px
```

Section grouping and item heights (y offsets from the dropdown top):

| section | height | items |
|---|---|---|
| 1 (y 158) | 137 | Google Account · Switch account ▸ · Sign out |
| 2 (y 295) | 97 | YouTube Studio · Purchases and memberships |
| 3 (y 392) | 257 | Your data in YouTube · Appearance ▸ · Display language ▸ · Restricted Mode ▸ · Location ▸ · Keyboard shortcuts |
| 4 (y 649) | 57 | Settings |
| 5 (y 706) | 96 | Help · Send feedback |

Sections carry no visible border; the 8px top/bottom padding on each is what reads
as a divider. Items whose label is a setting render as `Label: Value` in one string
(e.g. "Appearance: Device theme"). Every item is 40px tall; there is no 48px row.

---

## 11. Shorts, signed in

```
ytd-shorts                                1272 wide  margin-top 8px
  ytd-reel-video-renderer
    #player-container                     radius 12px
```

**Right action rail** — `button-view-model` stack outside the player's right edge:

```
x = 1206 (player right edge + 34)
y = 435, 513, 591, 669           ← 78px pitch

each: button   48 × 48   radius 24px   Tonal Mono SizeL IconButton
      bg rgba(255,255,255,0.1)   glyph 24px, #f1f1f1
      div.ytSpecButtonShapeWithLabelLabel
            12px / 18px  w400  #f1f1f1   margin 4px -8px 0
```

The four labels are: **like count** (e.g. «334K»), **comment count** (e.g. «2,190»),
**"Share"**, **"Remix"**. Counts are real numbers, not placeholders — the like and
comment buttons show live counts; Share and Remix show static words. The label is
allowed to overflow the 48px button by 8px on each side (`margin: 4px -8px 0`).

**Vertical navigation** — `56 × 56`, radius 28px, `Tonal Mono SizeXl IconButton`, at
x = 1432, i.e. a further 178px right, well clear of the action rail.

**Channel affordance** (bottom-left of the player, 16px inset):

```
yt-reel-metapanel-view-model                 480 × 60   @ x=479
  yt-reel-channel-bar-view-model             211.7 × 32
    yt-avatar-shape                          32 × 32
    a  «@handle»                             14px / 20px  w400  #fff
                                             (span padding 0 8px)
    Subscribe button                         77.6 × 32   radius 16px
        Filled Overlay SizeS DisableTextEllipsis
        bg #fff, text #000, padding 0 12px, 12px / 32px w500
  yt-shorts-video-title-view-model           386.5 × 20
    span  «title #hashtags»                  14px / 20px  w400  #fff
```

Note the palette flip: everything in the metapanel uses the **Overlay** variants
(white on artwork), while the action rail uses **Mono** on the page background.

---

## 12. YouTube Studio (`studio.youtube.com`)

Studio is a different app with a **different token namespace** layered on top of the
same `--yt-sys-*` colours (2498 custom properties total; `--ytcp-font-*` 90,
`--ytcp-static-*` 19, `--ytcp-text-*`, plus `--yt-sys-*` 241).

### 12.1 The `--ytcp-font-*` typescale

Unlike the main app (which has no named typescale — it inlines sizes per
component), Studio ships a complete one. Values are in `rem` against a 10px root,
so `1.4rem` = 14px.

| role | size | line-height | weight |
|---|---|---|---|
| `display1` | 4.0rem / 40px | 5.4rem / 54px | 300 |
| `genai-message` | 3.2rem / 32px | 4.4rem / 44px | 700 |
| `yt-headline1` | 3.2rem / 32px | — | — |
| `headline` | 2.4rem / 24px | 3.2rem / 32px | 700 |
| `title` / `title2` | 2.0rem / 20px | 2.8rem / 28px | 700 |
| `card-title` | 1.8rem / 18px | 2.6rem / 26px | 700 |
| `subheading` | 1.6rem / 16px | 2.2rem / 22px | 400 |
| `subheading2` | 1.6rem / 16px | 2.2rem / 22px | 500 |
| `body1` | 1.4rem / 14px | 2.0rem / 20px | 400 |
| `body2` | 1.4rem / 14px | 2.0rem / 20px | 500 |
| `button` | 1.4rem / 14px | 2.0rem / 20px | 500 |
| `caption1` | 1.2rem / 12px | 1.8rem / 18px | 400 |
| `caption2` | 1.2rem / 12px | 1.8rem / 18px | 500 |

Also `--ytcp-font-system-family: "Roboto","Arial",sans-serif`,
`--ytcp-font-weight-roboto-regular: 400`, `--ytcp-font-weight-roboto-medium: 500`.

`--ytcp-static-*`: `brand-red #f03`, `brand-white #fff`, `yellow #fbc02d`,
`overlay-text-primary #fff`, `overlay-text-secondary rgba(255,255,255,0.7)`,
`overlay-background-{medium 0.6, heavy 0.8, red rgba(225,0,45,0.9)}`,
`overlay-tooltip-background #606060`, `overlay-drop-shadow-a40 rgba(0,0,0,0.4)`.
`--ytcp-text-disabled #717171`.

### 12.2 Shell

```
masthead                    1512 × 64        bg #0f0f0f     ← 64px, not 56px
left nav                    248 wide  @ y=64  padding-right 8px
  channel avatar block      (avatar, "Your channel", «name») above the item list
  tp-yt-paper-icon-item     215 × 40  radius 8px  padding 8px 8px 8px 4px  margin 0 12px
      label 14px / 20px  —  w500 when active, w400 otherwise
      active bg rgba(255,255,255,0.1)
  11 items: Dashboard · Content · Analytics · Community · Subtitles ·
            Content detection · Earn · Customization · Audio library ·
            (footer) Settings · Send feedback
dashboard cards             394 wide, stacked with 24px bottom margin
```

### 12.3 Content / videos table (`/videos`)

```
page title  «Channel content»       ytcp-font-title  20px / 28px  w700  (rendered 36px
                                    at page-header scale)

tp-yt-paper-tabs                    1216 × 48  @ x=272
  tp-yt-paper-tab                   14px  w500   margin-right 32px, left inset 8px
  9 tabs: Inspiration · Videos · Shorts · Live · Posts · Playlists ·
          Podcasts · Promotions · Collaborations
  #selectionBar                     49 × 2   radius 2px   bg #f1f1f1   margin-left 8px

filter bar                          «Filter» input with a leading filter glyph, 48px band

ytcp-table-header                   1264 × 48   bg #0f0f0f
  span.ytcp-table-header            12px / 47px  w500  #aaa
                                    → w700 on the currently-sorted column
  column x-origins:  320 (Video) · 821 (Notices) · 993 (Visibility) ·
                     1149 (Date, sorted, with a ↓ glyph) · 1336 (Views) · 1429 (Comments)

ytcp-video-row                      1264 × 84
  checkbox                          32 wide  padding 4px   @ x=272
  thumbnail img                     120 × 68  radius 8px   @ x=320
                                    (with a duration chip bottom-right)
  #video-title  «title»             14px / 20px  w400      @ x=456
  below it: «Add description» placeholder in #aaa
  visibility cell: 24px glyph + «Unlisted|Public|Private» 14px/20px
  date cell: two lines — «date» then «Uploaded|Published»
```

Row hover reveals an inline action strip (analytics, comments, edit, overflow) in
the title cell, and a chevron next to the visibility value.

### 12.4 Create menu

`Create` button (top-right, `ytcpButtonShapeImpl` outline style, 36px tall) opens a
5-item dropdown at x ≈ 1228, 40px rows, 24px leading glyphs:

```
Upload videos · Go live · Create post · New playlist · New podcast
```

The last two carry no glyph — the icon column is left blank rather than collapsed.

### 12.5 Upload dialog

```
tp-yt-paper-dialog.ytcp-uploads-dialog       960 × 731
      bg #212121   radius 24px   margin 24px 40px
  div.dialog-content
    header                                   960 × 61
      title  «Upload videos»                 20px / 28px  w700  @ 24px inset
      (send-feedback icon button + close X on the right)
    ytcp-uploads-file-picker                 960 × 646   margin-bottom 24px
      icon circle                            136 × 136   radius 68px (50%)
                                             bg rgba(255,255,255,0.1)
      p.label «Drag and drop video files to upload»
                                             16px / 22px  w400   margin-top 23px
      "Select files" button                  101 × 36   margin 26px 0 167.5px
             ytcpButtonShapeImplHost ytcpButtonShapeImpl--filled
             ytcpButtonShapeImpl--mono ytcpButtonShapeImpl--size-m
             text 14px / 36px  w500  colour #030303
      p.disclaimer                           12px / 24px  w400  #aaa
             inline links 12px / 24px  w500  #3ea6ff
             («…agree to YouTube's Terms of Service and Community Guidelines.»
              «Please ensure your videos don't violate anyone else's privacy or
               copyright. Learn more»)
```

> **Gap — the step flow was not captured.** The four-step stepper
> (Details → Video elements → Checks → Visibility) **does not exist in the DOM
> until a file has actually been selected**: with the dialog open and no file,
> `ytcp-stepper` / `#stepper` / `.step` return **0 nodes**. Reaching it requires a
> real upload to the user's channel, which is out of scope for a research lane.
> §12.6 captures the closest reachable analogue.

### 12.6 Video details editor — the Details step's form, reachable without uploading

Opening an existing video's edit page renders the same
`ytcp-video-metadata-editor` that the upload dialog's step 1 mounts.

```
ytcp-video-metadata-editor            1120 wide   padding 0 24px   @ x=248
  left column                          696 wide  @ x=272
  right column                         376 wide  @ x=968   padding-left 24px

── left column ───────────────────────────────────────────────
Title (required)  ytcp-social-suggestions-textbox   696 × 79   radius 8px
   label       12px / 16px  w500  #aaa   margin 8px 0 3px   (+ a help "?" glyph)
   input       16px / 22px  w400  #f1f1f1
   field is transparent with a 1px outline, not a filled box
Description       696 × 225   radius 8px
   placeholder «Tell viewers about your video (type @ to mention a channel)»
Thumbnail   h3 section label  16px / 22px  w500
   3 option tiles, 153 × 84 each, 8px gaps:
     «Upload file» · «Select from video» · «A/B Testing»
   «Get suggestions» pill below
Playlists   h3 + a «Select» dropdown, 336 wide
… (Audience, Age restriction, Paid promotion, Tags, Language, etc. follow)

── right column (cards) ──────────────────────────────────────
preview card       thumbnail + «Video link» + «Video quality» SD/HD chips
                   + «Get video feedback» pill
Notices card
Visibility card    24px glyph + «Unlisted|Public|Private» + chevron
Subtitles card     (with a pencil edit affordance)
End screen card

── page actions (top right, y≈81) ────────────────────────────
«Undo changes» ytcp-button 62.3+ × 36     «Save» ytcp-button      overflow ⋮
```

Video-level left nav replaces the channel nav with **7** items: Details ·
Analytics · Editor · Comments · Subtitles · Claims · Clips — same
`tp-yt-paper-icon-item` 215 × 40 / radius 8px geometry.

---

## 13. Gaps and caveats

1. **Upload stepper** — not capturable without performing a real upload (§12.5).
   §12.6 gives the Details-step form; the Video elements / Checks / Visibility steps
   remain unmeasured.
2. **Viewport** — captured at 1512 × 827 (physical display limit), so column counts
   differ from R8's 1920 captures. The `--ytd-rich-grid-item-min-width` of
   **326.8px** is what determines the count; derive columns from it rather than
   copying "3 per row".
3. **Subscriptions feed day-grouping and list view do not exist** in this build
   (§5). If the replica's spec assumes them, the spec is targeting an older YouTube.
4. **`--yt-spec-*` is not a live namespace** (§1). Any prior research or generated
   CSS referencing it is targeting a build that shipped years ago.
5. Notification-bell dropdown, the `Switch account` submenu, and the notification-
   level menu behind the subscribed bell were not opened (each would have required
   interacting with account state).
6. Light theme was not captured for these surfaces; the token names carry
   `-inverse` counterparts for every colour role used above, which is the intended
   light-theme mechanism.

---

## 14. What this changes for the replica

* Build the theme layer as **`--yt-sys-color-baseline--*` + `--yt-sys-measurement--*`**,
  with the t-shirt scales from §1.1 as the only spacing vocabulary. Every component
  below then falls out of the tokens rather than being hand-tuned.
* Build **one** `Button` with the `variant × palette × size × icon-mode` matrix in
  §2.1, **one** `Chip` (§2.2), **one** `Lockup` with a `vertical | horizontal |
  collectionStack` layout prop (§2.3). That trio covers home, subscriptions,
  history, You, playlists, watch, and search.
* Copy the **two-layer interaction model**: buttons do not change `background` on
  hover; they cross-fade a `Stroke` and a `Fill` overlay sibling at the `state-*`
  token opacities. Getting this wrong is the most visible "not quite YouTube" tell.
* Signed-in-only surface area to schedule: masthead `#buttons` cluster, guide
  subscriptions + You sections with the 4px `#3ea6ff` newness dot, the account menu,
  `/feed/subscriptions`, `/feed/channels`, `/feed/history` (+ its right rail),
  `/feed/you`, `/feed/playlists`, `/playlist?list=WL`, the watch-page action row and
  Save sheet, the comment composer, the Shorts action rail, and Studio.
* The **Save-to-playlist sheet** (§9.3) is a contextual anchored sheet with bookmark
  toggles and no confirm button — model it as an immediate-write list, not a form.
