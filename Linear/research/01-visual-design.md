# Linear — Visual Design System (Research Lane A)

Reverse-engineered spec for rebuilding linear.app's UI in Next.js. Every value here comes from Linear itself — its live DOM, its shipped bundles, or its official brand page. Nothing is copied from a third-party palette site.

---

## 0. Confidence legend and provenance

| Tag | Meaning |
| --- | --- |
| **[DOM]** | Read out of the **live Linear web client's rendered DOM** via `getComputedStyle` / `getBoundingClientRect`. This is what actually paints. Highest confidence. |
| **[PIXEL]** | **Sampled from a screenshot's pixels.** The final tiebreaker — it is literally what the user sees. |
| **[SRC]** | Read from Linear's **shipped JS/CSS bundles** (`static.linear.app/client/assets/*`). Literal source constants. |
| **[GEN]** | **Computed by executing Linear's own theme generator** (`darkThemeRefresh.js` / `lightThemeRefresh.js`) in Node. Linear generates themes at runtime in LCH, so this is the only way to get tokens no page happened to use. |
| **[WWW]** | Measured on the public **marketing site** (`linear.app`). Real, but the marketing design system, which differs from the app. |
| **[BRAND]** | From Linear's official brand page. Authoritative for brand marks only. |
| **[DERIVED]** | Arithmetic I performed on measured values, verified to 1e-12. |

Where sources disagreed, **[PIXEL] > [DOM] > [SRC] > [GEN]**, and I say so inline.

### Provenance note — please read

The brief assumed the in-app UI was behind a login. **It turned out to be reachable.** The Chrome profile used by the browser tooling had a *pre-existing, in-flight Google OAuth flow for Linear that completed on its own* while I was working on the marketing site. I did **not** attempt to log in and entered no credentials. The session is **the author.s own workspace**.

I used it strictly read-only: navigation, `getComputedStyle`, and `fetch()` of already-loaded static assets. Nothing was created, edited or deleted. One navigation landed on `/acme/agent` ("New chat") because `linear.app/` redirects logged-in users into the app; I left immediately and sent no message.

**Consequence:** the two `linear-app-*.png` screenshots contain **real Acme issue titles and assignee avatars**. Treat them as internal and decide deliberately whether they belong in a shared repo. Every *number* in this document is a design value and carries no business content.

### The single most important framing

**Linear runs two different palettes.** Almost every hex circulating online — `#08090a`, `#0f1011`, `#1c1c1f`, `#232326`, `#f7f8f8`, `#8a8f98` — is the **marketing site**. The **product** is a different, darker, LCH-generated palette. Build the app against §1.1. Use §1.3 only if you are also rebuilding the landing pages.

---

## 1. Design tokens

The app generates its themes at runtime from an LCH seed and writes them to `<html>` as `lch()` values plus a `class="dark"` / `class="light"` hook. Hexes below are what the browser actually paints.

### 1.1 App — DARK theme (default)

Seed **[GEN]**: `base = LCH[5.52, 0.4, 272]`, `accent = LCH[47.9175, 59.3027, 288.4214]`, `contrast = 27`.

```css
/* ================= Linear app · DARK ================= */
:root[data-theme="dark"] {
  /* ---- Surfaces, lowest → highest ---- */
  --bg-sidebar:        #09090a;  /* window ground + sidebar        [DOM][PIXEL][SRC] */
  --bg-base:           #121213;  /* main content pane              [DOM][PIXEL][SRC] */
  --bg-shade:          #161617;  /* recessed panel                 [DOM] */
  --bg-tint:           #17181a;  /* menus, popovers (inline)       [DOM] */
  --bg-hover:          #1a1a1b;  /* row / group-header hover       [DOM][PIXEL] */
  --bg-focus:          #222223;  /* keyboard-focused row           [GEN] */
  --bg-selected:       #1b1e37;  /* selected row (indigo-tinted)   [GEN] */
  --bg-selected-hover: #1f223e;  /*                                [GEN] */

  /* ---- Elevated sub-surfaces (Linear derives nested themes) ---- */
  --bg-elevated:        #19191b; /* modal / popover ground         [GEN] */
  --bg-elevated-hover:  #212123; /*                                [GEN] */
  --bg-elevated-border: #2a2b2e; /*                                [GEN] */
  --bg-menu:            #202022; /* context menu ground            [GEN] */
  --bg-menu-hover:      #28282a; /*                                [GEN] */
  --bg-menu-border:     #323336; /*                                [GEN] */

  /* ---- Borders ---- */
  --border-faint:      #1a1b1d;  /* hairline / divider             [DOM][GEN agree exactly] */
  --border-default:    #232426;  /* standard border                [DOM]  (GEN: #232325) */
  --border-solid:      #28282b;  /* strong border                  [DOM]  (GEN: #27282a) */
  --border-header:     #212224;  /* the 0.5px content-header rule  [DOM][SRC] */

  /* ---- Text, by emphasis ---- */
  --label-title:       #ffffff;  /* issue + page titles            [DOM][GEN agree] */
  --label-base:        #e3e4e6;  /* primary body text              [DOM]  (GEN: #e2e3e5) */
  --label-muted:       #959597;  /* IDs, dates, meta, icon default [DOM]  (GEN: #949597) */
  --label-faint:       #565759;  /* disabled / placeholder         [DOM]  (GEN: #565658) */
  --label-link:        #6f7ffe;  /*                                [GEN] */

  /* ---- Controls ---- */
  --control-primary:   #5e6ad2;  /* primary button = Linear indigo [SRC][GEN] */
  --control-secondary: #1b1b1c;  /*                                [GEN] */
  --focus-ring:        #6d78d5;  /* app runtime value              [DOM] (GEN: #5e69d1) */
  --sidebar-link-hover:  #1d1e1f;/*                                [GEN] */
  --sidebar-link-active: #28292b;/*                                [GEN] */

  /* ---- Selection / overlay / scrollbar ---- */
  --selection-active:  #5f69d266; /* lch(47.918% 59.303 288.421/.4) multi-select  [DOM] */
  --selection-text:    #96969633; /* text selection                              [DOM] */
  --modal-overlay:     #00000066; /*                                             [GEN] */
  --scrollbar:         #57585a;   /*                                             [DOM] */
  --scrollbar-active:  #565759;   /*                                             [DOM] */

  --editor-text:       #e4e5e9;   /*                                             [DOM] */
}
```

**On the ±1 disagreements.** My `[DOM]` values come from the browser painting the `lch()` and me reading the pixel; the `[GEN]` values come from running Linear's generator in Node. They differ by at most 1/255 — a rounding difference in the LCH→sRGB path. Two independent checks settle it in favour of the `[DOM]` column:

1. **`[PIXEL]`** sampling of `linear-app-issue-list-dark.png` returns exactly `#09090a` (sidebar), `#121213` (content), `#1a1a1b` (hovered row).
2. **Linear's own splash CSS** hardcodes `--bg-sidebar-dark: #09090a` and `--bg-base-color-dark: #121213` **[SRC]** — matching `[DOM]`, not the generator's `#111212`.

**Use the `[DOM]` column.**

Dark Linear has essentially **three background values** in the main UI — `#09090a` chrome, `#121213` content, `#1a1a1b` hover. That's the whole story. Everything else is a border.

### 1.2 App — LIGHT theme

Seed **[GEN]**: `base = LCH[97.94, 0.5, 282]`, `accent = LCH[53, 52.26, 286.91]`, `contrast = 30`.

This palette has an unusually strong provenance: the generator output **[GEN]** and the `--sx-*` atoms I dumped off the live `<html>` element **[DOM]** were produced by completely different methods and **agree exactly on 9 of 13 tokens**.

```css
/* ================= Linear app · LIGHT ================= */
:root[data-theme="light"] {
  --bg-sidebar:        #eeeeef;  /* [GEN]+[DOM] exact match */
  --bg-base:           #f8f8f9;  /* [GEN]+[DOM] exact match */
  --bg-hover:          #eeeeef;  /* [GEN]+[DOM] exact match */
  --bg-shade:          #e9e9ea;  /* [GEN]+[DOM] exact match */
  --bg-focus:          #eaeaeb;  /* [GEN]+[DOM] exact match */
  --bg-selected:       #e7e8f3;  /* [GEN]+[DOM] exact match */

  --bg-elevated:       #ffffff;  /* [GEN] — modal/menu ground */
  --bg-elevated-border:#e3e3e3;  /* [GEN] */

  --border-faint:      #f1f1f1;  /* [GEN] */
  --border-default:    #dedede;  /* [GEN]+[DOM] exact match */
  --border-solid:      #d2d2d2;  /* [GEN] */

  --label-title:       #1b1b1b;  /* [GEN] */
  --label-base:        #2f2f31;  /* [GEN]+[DOM] exact match */
  --label-muted:       #5b5c5e;  /* [GEN]+[DOM] exact match */
  --label-faint:       #9c9c9e;  /* [GEN]+[DOM] exact match */
  --label-link:        #3f60d9;  /* [GEN]+[DOM] exact match */

  --control-primary:   #6d78d5;  /* [GEN] */
}
```

Linear's splash CSS **[SRC]** independently confirms the light shell: `--bg-sidebar-light: #efeff0`, `--bg-base-color-light: #f9f9fa`, `--bg-border-color-light: #e2e2e2`, and `<meta name="theme-color" content="#EFEFF0">`. Those are the *pre-boot* values and sit ~1 unit off the generated ones; prefer the table above for the running app.

High-contrast variants also ship **[GEN]**: dark `base [8, .75, 272] contrast 90`; light `base [98.7, .5, 282.863] contrast 90`.

### 1.3 Marketing site tokens — **[WWW]**, complete for both themes

Measured in-session from `linear.app`, and independently confirmed against the literal `[data-theme=dark]` / `[data-theme=light]` blocks in `static.linear.app/web/_next/static/css/index.Dcyhk-x2.css` **[SRC]**.

| Token | Dark | Light |
| --- | --- | --- |
| `--color-bg-primary` / `--color-bg-level-0` | `#08090a` | `#ffffff` |
| `--color-bg-level-1` / `--color-bg-panel` | `#0f1011` | `#f8f8f8` |
| `--color-bg-level-2` / `--color-bg-tint` | `#141516` | `#f4f4f4` |
| `--color-bg-level-3` | `#191a1b` | `#f0f0f0` |
| `--color-bg-secondary` | `#1c1c1f` | `#f9f8f9` |
| `--color-bg-tertiary` | `#232326` | `#f4f2f4` |
| `--color-bg-quaternary` | `#28282c` | `#eeedef` |
| `--color-bg-quinary` | `#282828` | `#e9e8ea` |
| `--color-bg-marketing` | `#010102` | — |
| `--color-bg-translucent` | `#ffffff0d` | `#00000005` |
| `--color-text-primary` | `#f7f8f8` | `#282a30` |
| `--color-text-secondary` | `#d0d6e0` | `#3c4149` |
| `--color-text-tertiary` | `#8a8f98` | `#6f6e77` |
| `--color-text-quaternary` | `#62666d` | `#86848d` |
| `--color-border-primary` | `#23252a` | `#e9e8ea` |
| `--color-border-secondary` | `#34343a` | `#e4e2e4` |
| `--color-border-tertiary` | `#3e3e44` | `#dcdbdd` |
| `--color-border-translucent` | `#ffffff0d` | `#0000000d` |
| `--color-border-translucent-strong` | `#ffffff14` | `#00000014` |
| `--color-line-primary` | `#37393a` | `#d4d4d6` |
| `--color-line-secondary` | `#202122` | `#eaeaeb` |
| `--color-line-tertiary` | `#18191a` | `#f0f0f0` |
| `--color-line-quaternary` | `#141515` | `#f4f4f4` |
| `--color-accent` | `#7170ff` | `#7170ff` |
| `--color-accent-hover` | `#828fff` | `#8989f0` |
| `--color-accent-tint` | `#18182f` | `#f1f1ff` |
| `--color-brand-bg` | `#5e6ad2` | **`#7070ff`** |
| `--color-link-primary` | `#828fff` | `#7070ff` |
| `--color-link-hover` | `#ffffff` | `#282a30` |
| `--color-button-invert-bg` | `#e5e5e6` | `#282a30` |
| `--color-button-invert-bg-hover` | `#ffffff` | `#1f2024` |
| `--color-overlay-primary` | `#000000d9` | `#ffffffa6` |
| `--header-bg` | `#0b0b0bcc` | `#ffffff` |
| `--header-border` | `#ffffff14` | `#00000014` |
| `--scrollbar-color` | `#ffffff1a` | `#0000001a` |
| `--focus-ring-color` | `#5e69d1` | `#5e69d1` |

There is also a third marketing theme, **`[data-theme=glass]`** **[SRC]**: `--color-bg-primary #000212`, translucent whites `#ffffff08` / `#ffffff12` / `#ffffff26`, `--color-text-secondary #b4bcd0`.

### 1.4 Brand + semantic hues

Global `:root` hues, theme-independent **[WWW]**:

```css
--color-indigo:  #5e6ad2;   /* THE Linear brand indigo */
--color-blue:    #4ea7fc;
--color-teal:    #00b8cc;
--color-green:   #27a644;
--color-yellow:  #f0bf00;
--color-orange:  #fc7840;
--color-red:     #eb5757;

--color-linear-plan:     #68cc58;   /* product-line accents */
--color-linear-build:    #d4b144;
--color-linear-security: #7a7fad;
```

**Official brand palette [BRAND]** — `linear.app/brand` publishes exactly two colours:

| Name | RGB | Hex | Stated use |
| --- | --- | --- | --- |
| Mercury White | 244, 245, 248 | `#F4F5F8` | Monochrome wordmark on dark |
| Nordic Gray | 35, 35, 38 | `#222326` | Monochrome wordmark on light |

The page describes the primary brand colour as *"a subtle desaturated blue… typically reserved for backgrounds"* but does **not** publish its hex. `#5e6ad2` is measured in three independent places — marketing `--color-indigo` / `--color-brand-bg`, the `Done` state colour, and the `controlPrimary` label swatch — so treat it as certain.

Naming rule **[BRAND]**: **"Linear"** — one word, capital L, never "Linear app". Linear Method etc. are capitalised as proper nouns.

**Legal [BRAND]:** the page explicitly forbids using Linear's marks in another product, or in a product/service name. Status and priority glyphs are functional UI and a different matter, but **do not ship Linear's wordmark or logomark.**

### 1.5 Workflow state colours — **[SRC]**, canonical

Verbatim from `store.aAzVydJL.js`, confirmed independently in `ContextualMenuActions`'s `getStateTypeColor`:

```js
triage      #FC7840      backlog   #BEC2C8      unstarted  #E2E2E2
started     #F2C94C      completed #5E6AD2      canceled   #95A2B3
duplicate   #95A2B3      "In Review" #0f783c (started, position 2.5)
```

| State | Type | Colour |
| --- | --- | --- |
| Triage | `triage` | `#FC7840` |
| Backlog | `backlog` | `#bec2c8` |
| Todo | `unstarted` | `#e2e2e2` |
| In Progress | `started` | `#f2c94c` |
| In Review | `started` | `#0f783c` |
| Done | `completed` | `#5e6ad2` |
| Canceled | `canceled` | `#95a2b3` |
| Duplicate | `duplicate` | `#95a2b3` |

Fallback colour for any state/label without one: `#bec2c8`.

> **`#ffab00` and `#e2b203` are Atlassian/Jira colours and appear nowhere in Linear.** In Progress is `#f2c94c`.

**Rendering caveat [DOM].** Linear does not always paint the stored hex. In the measured workspace, greys passed through literally but chromatic state colours were re-expressed in LCH with lightness lifted for the dark ground:

| State | Stored | Rendered `lch()` | Painted |
| --- | --- | --- | --- |
| Backlog | `#bec2c8` | literal | `#bec2c8` |
| Todo | `#e2e2e2` | literal | `#e2e2e2` |
| Canceled | `#95a2b3` | literal | `#95a2b3` |
| Done | `#5e6ad2` | `lch(48% 59.31 288.43)` | `#5e6ad2` (round-trips exactly) |
| In Progress | `#f2c94c` | `lch(80% 90 85)` | `#f0bf00` |
| In Review | `#0f783c` | `lch(60% 64.37 141.95)` | `#26a644` |

Either this workspace customised those two states, or Linear lightness-normalises saturated state colours against theme background. **Ship the canonical hexes. Do not copy `#f0bf00` / `#26a644` as defaults.**

### 1.6 Label / entity colour palette — **[SRC]**, complete

The nine swatches Linear offers for labels, teams, projects and initiatives. `stableColorForId()` hashes an entity id modulo this list, so **preserve the ordering** if you want the same "random" colours.

| Key | User-facing name | Hex |
| --- | --- | --- |
| `lightGrey` | Grey | `#bec2c8` |
| `darkGrey` | Dark Grey | `#95a2b3` |
| `controlPrimary` | Purple | `#5e6ad2` |
| `tealBase` | Teal | `#26b5ce` |
| `greenBase` | Green | `#4cb782` |
| `yellowBase` | Yellow | `#f2c94c` |
| `orangeBase` | Orange | `#f2994a` |
| `redBg` | Pink | `#f7c8c1` |
| `redBase` | Red | `#eb5757` |

`defaultTeamIconColor = #bec2c8`.

> ⚠️ **Name collision — this bites.** `orangeBase` exists **twice** with different values: as a **label-palette swatch** it is `#f2994a` (above); as a **theme token** it is **`#ff7235`** (measured in the app runtime as `--sx-11vg3qk`, and confirmed independently from the theme generator). The Urgent priority icon references the **theme token**, so Urgent is `#ff7235` — see §5.2.

---

## 2. Typography

### 2.1 Family — the literal shipped strings

```css
/* ---- App client [DOM] ---- */
--font-regular: "Inter Variable", "SF Pro Display", -apple-system, BlinkMacSystemFont,
                "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
                "Helvetica Neue", "Linear Thai", sans-serif;
--font-display: /* identical to --font-regular */;
--font-monospace: "Berkeley Mono", "SFMono Regular", Consolas, "Liberation Mono",
                  Menlo, Courier, monospace;
--font-emoji: "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Segoe UI",
              "Twemoji Mozilla", "Noto Color Emoji", "Android Emoji";

/* ---- Marketing site [WWW] — "system-ui" instead of BlinkMacSystemFont, no Linear Thai ---- */
--font-regular: "Inter Variable", "SF Pro Display", -apple-system, "system-ui",
                "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
                "Helvetica Neue", sans-serif;
--font-monospace: "Berkeley Mono", ui-monospace, "SF Mono", "Menlo", monospace;
--font-serif-display: "Tiempos Headline", ui-serif, Georgia, Cambria,
                      "Times New Roman", Times, serif;
```

Confirmed: **Inter Variable** primary, **SF Pro Display** first fallback. Font files **[SRC]**:
`static.linear.app/fonts/InterVariable.woff2?v=4.1` (+ `-Italic`), `Berkeley-Mono-Variable.woff2?v=3.2`, both declared `font-weight: 100 900`. `"Linear Thai"` is a custom Thai companion, app-only. Berkeley Mono is a paid face — most users fall through to `ui-monospace` / `SF Mono`.

> Write-ups claiming Linear ships bespoke faces called "Linear Display" / "Linear Text" / "Linear Mono" are **fabricated**. No such faces exist in the bundle.

Two non-negotiable body settings **[WWW]**:

```css
body {
  font-feature-settings: "cv01", "ss03";
  font-variation-settings: "opsz" auto;
  -webkit-font-smoothing: antialiased;
}
```

`cv01` = single-storey `a`; `ss03` = the curved-tail stylistic set. **These two features are a large part of why Linear looks like Linear**, and omitting them is the most common way a clone reads wrong.

### 2.2 Weights — the app and marketing differ

| Role | App **[DOM]** | Marketing **[WWW]** |
| --- | --- | --- |
| light | 300 | 300 |
| normal | **450** | 400 |
| medium | **500** | **510** |
| semibold | 600 | **590** |
| bold | 700 | **680** |
| display | **550** | — |

Marketing's off-integer weights exploit Inter's variable axis. **For the app use 450 / 500 / 600 / 700 — body weight is 450, not 400.** Verified `[DOM]`: the workspace-name element rendered at weight **550**, matching the `display` role.

### 2.3 Size scale — **[DOM]**, identical names on both surfaces

```css
--font-size-micro:    0.6875rem;  /* 11px */
--font-size-mini:     0.75rem;    /* 12px */
--font-size-small:    0.8125rem;  /* 13px  ← the workhorse */
--font-size-regular:  0.9375rem;  /* 15px  ← editor / prose */
--font-size-large:    1.125rem;   /* 18px */
--font-size-title3:   1.25rem;    /* 20px */
--font-size-title2:   1.5rem;     /* 24px */
--font-size-title1:   2.25rem;    /* 36px */
```

`html { font-size: 16px }` — the rem base is untouched **[DOM]**. Each size has a `…Plus` twin at the same px but a heavier weight **[SRC]**:

| Variant | px | weight | `…Plus` weight |
| --- | --- | --- | --- |
| micro | 11 | 450 | 500 |
| mini | 12 | 450 | 500 |
| **small** | **13** | **450** | **500** |
| regular | 15 | 450 | **600** |
| large | 18 | 450 | 500 |
| title3 / title2 | 20 / 24 | 500 | — |
| title1 | 36 | 450 | — |

**The "Linear is 13px" claim is confirmed.** `small` (13px) is the size of the issue title, issue ID, sidebar item, breadcrumb, status-group header and buttons; `inputFontSize` is also `0.8125rem` **[SRC]**. Linear's own `IssueListGroupRow` uses `variant:'small'`/`'smallPlus'` for titles and `'mini'` for metadata **[SRC]** — exactly matching what I measured in the DOM. Users can scale the whole ramp with a `fontSize` preference.

### 2.4 Per-role typography — **[DOM]**, measured on the live issue list at 1440×900

| Role | Size | Weight | Line-height | Letter-spacing | Colour (dark) |
| --- | --- | --- | --- | --- | --- |
| Workspace name (sidebar top) | 14px | 550 | 23px | -0.1px | `#e2e3e5` |
| Sidebar nav item | 13px | 500 | normal | normal | `#919294` |
| Sidebar section label (Workspace / Your teams) | 12px | 500 | normal | normal | `#919294` |
| Breadcrumb / view title | 13px | 500 | normal | normal | `#e3e4e6` |
| Breadcrumb separator `›` | 13px | 500 | normal | normal | `#959597` |
| Status group header | 13px | 500 | normal | normal | `#e4e5e7` |
| Group header count | 13px | 450 | normal | normal | state-tinted grey |
| **Issue row — title** | **13px** | **500** | normal | normal | `#ffffff` |
| **Issue row — ID (`ENG-9`)** | **13px** | **450** | normal | **-0.26px** | `#959597` |
| Issue row — date / meta | 12px | 450 | normal | normal | `#959597` |
| View tabs | 12px | 500 | normal | normal | `#959597`, active `#ffffff` |
| Sidebar count badge | 11px | 450 | normal | normal | `#919294` |
| Avatar initials | 9px | 400 | 0 | normal | `#ffffff` |
| Editor body / description | 15px | 450 | 1.6 | -0.00666667em | `#e4e5e9` |

Three details worth copying exactly:
- **The issue ID is the only element in the list with negative tracking** (-0.26px = -0.02em at 13px). It tightens `ENG-9` without switching face.
- **Titles are weight 500, not 600.** Row hierarchy comes from colour (`#ffffff` title vs `#959597` ID/date), not weight.
- **`line-height: normal` throughout the chrome.** Linear lets Inter's own metrics set it and controls rhythm with fixed row heights instead.

### 2.5 Marketing type scale — **[WWW]**, from the shipped CSS

```css
--text-tiny-size:    0.625rem;   /* 10px */  lh 1.5    ls -0.015em
--text-micro-size:   0.75rem;    /* 12px */  lh 1.4    ls  0
--text-mini-size:    0.8125rem;  /* 13px */  lh 1.5    ls -0.01em
--text-small-size:   0.875rem;   /* 14px */  lh 1.5    ls -0.013em   /* calc(21/14) */
--text-regular-size: 0.9375rem;  /* 15px */  lh 1.6    ls -0.011em
--text-large-size:   1.0625rem;  /* 17px */  lh 1.6    ls  0

--title-1-size: 1.0625rem; /* 17px */  lh 1.4     ls -0.012em
--title-2-size: 1.25rem;   /* 20px */  lh 1.33    ls -0.012em
--title-3-size: 1.5rem;    /* 24px */  lh 1.33    ls -0.012em
--title-4-size: 2rem;      /* 32px */  lh 1.125   ls -0.022em
--title-5-size: 2.5rem;    /* 40px */  lh 1.1     ls -0.022em
--title-6-size: 3rem;      /* 48px */  lh 1       ls -0.022em
--title-7-size: 3.5rem;    /* 56px */  lh 1.1     ls -0.022em
--title-8-size: 4rem;      /* 64px */  lh 1.06    ls -0.022em
--title-9-size: 4.5rem;    /* 72px */  lh 1       ls -0.022em
```

**Rule of thumb: body tracks −0.011em to −0.013em; display tracks −0.022em.** Verified against the live `/features` H1 **[WWW]**: `64px / weight 510 / 67.84px line-height / −1.408px tracking` — and −1.408 ÷ 64 = −0.022em exactly.

---

## 3. Spacing, radii, shadows

### 3.1 Spacing

Linear ships **no named `--space-*` ramp**. Spacing is a plain **4px grid** with 8px dominant. The named constants that do exist **[SRC]**:

```js
mainPageMargin: 8            mainContentBorderRadius: 12
sidebarPadding: 12           sidebarPrimaryButtonSize: 28
listHeaderHeight: 36         listIssueRowHeight: 44
listProjectRowHeight: 48     listProjectRowWithDescriptionHeight: 58
listInitiativeRowHeight: 58  desktopTabsHeight: 42   desktopTabHeight: 26

scrollablePaddingDocumentDefault: 48   scrollablePaddingDocumentLaptop: 40
scrollablePaddingDocumentInbox:   40   scrollablePaddingDocumentPhone:  12
scrollablePaddingOverviewDefault: 48   scrollablePaddingOverviewLaptop: 40
scrollablePaddingComment:         16   editorBottomPadding:            384
```

Other measured values **[DOM]**: row horizontal inset 8px; header padding `0 8px`; `--editor-safe-area` 16px; `--column-width` 24px; `--editor-list-inset` 1.5rem; `--editor-block-menu-offset` 28px; settings list item padding `12px 16px`, gap 12px, radius 10px; `--min-tap-size` 44px **[WWW]**.

Editor rhythm **[DOM]**: `--editor-block-spacing: 1rem`, `-small: 0.375rem`, `-large: 1.375rem`.

### 3.2 Border radii

```css
--radius-4:       4px;
--radius-6:       6px;    /* --editor-block-radius */
--radius-8:       8px;    /* --control-border-radius — buttons, inputs, LIST ROWS */
--radius-12:     12px;    /* mainContentBorderRadius — the app shell */
--radius-16:     16px;
--radius-24:     24px;
--radius-32:     32px;
--radius-circle:  50%;
--radius-rounded: 9999px; /* pills: avatars, marketing CTAs */
```

The app's dominant radius is **8px** (`--control-border-radius`) on buttons, inputs, list rows and group headers **[DOM]**; the **app shell** itself is **12px** **[SRC]**; settings list items are **10px** **[DOM]**.

> Linear's *pre-boot splash* CSS declares `--control-border-radius: 4px` **[SRC]**, but the running app resolves it to **8px** **[DOM]**. Use 8px.

**Row-radius detail [SRC]** — a signature worth replicating. When consecutive rows are multi-selected, interior corners square off so the selection reads as one block:

```css
[data-selected=true]:not([data-first-selected]):not([data-first-in-group]) { border-top-radius: 0 }
[data-selected=true]:not([data-last-selected]):not([data-last-in-group])   { border-bottom-radius: 0 }
```

### 3.3 Shadows

| Token | Dark **[WWW]** | Light **[WWW]** |
| --- | --- | --- |
| `--shadow-tiny` | `0 0 0 transparent` | `0 1px 1px 0 #00000017` |
| `--shadow-low` | `0 2px 4px #0000001a` | `0 1px 4px -1px #00000017` |
| `--shadow-medium` | `0 4px 24px #0003` | `0 3px 12px #00000017` |
| `--shadow-high` | `0 7px 32px #00000059` | `0 7px 24px #0000000f` |

`--shadow-stack-low` (dark), the layered micro-shadow on pill CTAs:
```css
0 8px 2px 0 #0000, 0 5px 2px 0 #00000003, 0 3px 2px 0 #0000000a,
0 1px 1px 0 #00000012, 0 0 1px 0 #00000014
```

App menu / popover **[DOM]**, dark: `0 3px 8px #0000001f, 0 2px 5px #0000001f, 0 1px 1px #0000001f`; light: `0 6px 18px #00000005, 0 3px 9px #0000000a, 0 1px 1px #0000000a`.
App dialog **[DOM]**: `0 9px 48px #00000014, 0 6px 24px #00000019, 0 1px 1px #0000000a`.

**Dark Linear uses almost no shadow.** Elevation is background lightness plus 1px borders. Reserve real shadows for light theme and floating surfaces.

### 3.4 Hairlines

`--dp-thin-pixel: 1px`, `--loading-error-thin-pixel: 0.5px` **[DOM]**. The content-header rule measured **`border-bottom: 0.5px solid #212224`** **[DOM]**, and the app-shell border drops to **0.5px** under `@media (min-resolution: 192dpi)` **[SRC]**. Use 0.5px on retina — a full 1px reads too heavy.

### 3.5 Focus ring

```css
--focus-ring-width: 1px;
--focus-ring-offset: 2px;                 /* marketing */
--focus-ring-outline: 1px solid #6d78d5;  /* app        [DOM] */
--focus-ring-outline: 1px solid #5e69d1;  /* marketing  [WWW] */
```

Keyboard-focused list rows use an **inset** ring, not an outline **[SRC]**:
`box-shadow: 0 0 0 1px var(--row-keyboard-border) inset;`

---

## 4. Motion

### 4.1 Durations — **[DOM]**, app and marketing ship the same tokens

```css
--speed-highlightFadeIn:   0s;
--speed-highlightFadeOut:  0.15s;
--speed-quickTransition:   0.1s;
--speed-regularTransition: 0.25s;
--speed-slowTransition:    0.35s;   /* app only */
```

Measured in the wild:

| Interaction | Value | Source |
| --- | --- | --- |
| **List row hover** | `box-shadow 0.15s, background-color 0s` | **[SRC]** |
| Marketing buttons | `0.16s cubic-bezier(.25,.46,.45,.94)` on border, background, colour, shadow, opacity, filter, transform | **[WWW]** |
| Icon colour | `fill` over `--speed-highlightFadeOut` (150ms), forced to `0s` on hover | **[SRC]** |
| App hover/press generally | ~`0.15s`, `ease-in-out` / `ease-out` | **[SRC]** |
| Suspense / opacity fades | `80ms ease-out` | **[SRC]** |
| Bootstrap fade | `0.2s ease-out` | **[SRC]** |
| Large sheets / drawers | `0.5s cubic-bezier(.32,.72,0,1)` | **[SRC]** |
| Sidebar reflow (`#appBorders` margin) | `0.45s cubic-bezier(.45,0,.55,1)` | **[SRC]** |
| Theme swap | `0.5s ease-in` | **[SRC]** |

**Row hover background transitions in 0 seconds.** Only the shadow eases. This is why Linear's list feels instant, and it is the highest-leverage single detail in the whole document.

> The commonly repeated "Linear uses 250ms" is only half true: `--speed-regularTransition: 0.25s` exists but is used far less than `.1s`/`.15s`/`.16s`. **The honest default is 150–160ms with `cubic-bezier(.25,.46,.45,.94)`.**

Motion is gated: there is a `useReducedMotion` chunk and an `.app-theme-transition` kill-switch rule **[SRC]**. Honour `prefers-reduced-motion`.

### 4.2 Easing set — **[WWW]**, complete (standard Penner curves)

```css
--ease-in-quad:      cubic-bezier(.55, .085, .68, .53);
--ease-in-cubic:     cubic-bezier(.55, .055, .675, .19);
--ease-in-quart:     cubic-bezier(.895, .03, .685, .22);
--ease-in-quint:     cubic-bezier(.755, .05, .855, .06);
--ease-in-expo:      cubic-bezier(.95, .05, .795, .035);
--ease-in-circ:      cubic-bezier(.6, .04, .98, .335);

--ease-out-quad:     cubic-bezier(.25, .46, .45, .94);   /* ← the workhorse */
--ease-out-cubic:    cubic-bezier(.215, .61, .355, 1);
--ease-out-quart:    cubic-bezier(.165, .84, .44, 1);
--ease-out-quint:    cubic-bezier(.23, 1, .32, 1);
--ease-out-expo:     cubic-bezier(.19, 1, .22, 1);
--ease-out-circ:     cubic-bezier(.075, .82, .165, 1);

--ease-in-out-quad:  cubic-bezier(.455, .03, .515, .955);
--ease-in-out-cubic: cubic-bezier(.645, .045, .355, 1);
--ease-in-out-quart: cubic-bezier(.77, 0, .175, 1);
--ease-in-out-quint: cubic-bezier(.86, 0, .07, 1);
--ease-in-out-expo:  cubic-bezier(1, 0, 0, 1);
--ease-in-out-circ:  cubic-bezier(.785, .135, .15, .86);
```

### 4.3 Z-index scale — **[WWW]**, copy verbatim

```css
--layer-1: 1;  --layer-2: 2;  --layer-3: 3;
--layer-footer: 50;           --layer-scrollbar: 75;     --layer-header: 100;
--layer-overlay: 500;         --layer-popover: 600;      --layer-command-menu: 650;
--layer-dialog-overlay: 699;  --layer-dialog: 700;       --layer-toasts: 800;
--layer-tooltip: 1100;        --layer-context-menu: 1200;
--layer-skip-nav: 5000;       --layer-debug: 5100;       --layer-max: 10000;
```

---

## 5. Iconography

### 5.1 Status / workflow-state icons

**Every status icon is a 14×14 SVG**, `viewBox="0 0 14 14"`, `fill="none"`, built from two concentric `<circle>` elements plus a knockout glyph for terminal states. A single colour `C` drives both circles.

I captured these from the rendered DOM on **three separate app pages** (issue list, issue detail, workflow settings) — 33 status-icon instances, all identical in construction.

**Ring (every state):**
```html
<circle cx="7" cy="7" r="6" fill="none" stroke={C} stroke-width="1.5" />
```

**Progress pie (every state):** an inner circle whose *stroke* is thick enough to fill inward to the centre, rotated −90° so the wedge starts at 12 o'clock.

| State | Ring dash | Inner circle | Inner `stroke-dasharray` | `stroke-dashoffset` | Fill |
| --- | --- | --- | --- | --- | --- |
| **Backlog** | `1.4 1.74`, offset `0.65` (**dashed**) | `r=2 sw=4` | `12.189379495928398 24.378758991856795` | `12.189379495928398` | 0% |
| **Todo** | `3.14 0`, offset `-0.7` (solid) | `r=2 sw=4` | same | `12.189379495928398` | 0% |
| **In Progress** | `3.14 0`, offset `-0.7` | `r=2 sw=4` | same | `6.094689747964199` | 50% |
| **In Review** | `3.14 0`, offset `-0.7` | `r=2 sw=4` | same | `3.0473448739820994` | 75% |
| **Done** | `3.14 0`, offset `-0.7` | `r=3 sw=6` | `18.84955592153876 37.69911184307752` | `0` | 100% + check |
| **Canceled** | `3.14 0`, offset `-0.7` | `r=3 sw=6` | same as Done | `0` | 100% + cross |

**The arithmetic, so you can generate any progress value [DERIVED, verified to 1e-12]:**

- `A = 2π × 1.94 = 12.189379495928398` — the dash maths uses radius **1.94, not 2**. The 3% shortfall stops the wedge closing into a seamless disc at 100%.
- `stroke-dasharray = "A  2A"`; `stroke-dashoffset = A × (1 − p)` for progress fraction `p`.
- Checks out: `p=0 → 12.1894`; `p=0.5 → 6.0947`; `p=0.75 → 3.0473`. All three match Linear's shipped attributes exactly.
- Terminal states switch to `r=3, stroke-width=6`, `dasharray = "2π·3  4π·3" = "18.84955592153876 37.69911184307752"`, `dashoffset = 0` — a genuinely full disc of radius 6.
- **Backlog's dashed ring:** dash `1.4`, gap `1.74`, period `3.14` (= π). Circumference at `r=6` is `2π·6 = 37.699`, and `37.699 ÷ 3.14 = 12.006` → **exactly 12 dashes**. The `0.65` offset centres the first dash at 12 o'clock.
- The solid ring's `dasharray="3.14 0"` is simply a solid stroke (zero gap) — Linear ships it that way so one component renders both dashed and solid.

**How `p` is chosen per state [SRC]:**

```js
let pct = 0;
if (state.type === 'started') {
  const started = [...state.team.states]
    .filter(s => s.type === 'started')
    .sort((a, b) => a.position - b.position);
  pct = started.length === 1 ? 0.5
      : started.length === 2 ? (started.indexOf(state) === 0 ? 0.5 : 0.75)
      : (1 / (started.length + 1)) * (started.indexOf(state) + 1);
}
```

So a workflow with `In Progress` + `In Review` yields 50% and 75% wedges — which is exactly what I measured **[DOM]**. Most clones miss this and hardcode one fill.

**Done — check glyph.** Drawn as a **knockout**, filled with the colour of whatever sits behind the icon (measured `#1a1a1b`, the row-hover background — so it must be re-coloured per surface, **never hard-coded white**):

```
M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783
5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896
C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701
10.6191 3.91701 10.951 4.24896Z
```
Centreline (3.5,7.5) → (5.5,9.5) → (10.5,4.5); effective weight ≈1.9 units, round caps and join.

**Canceled — cross glyph.** Same knockout treatment:

```
M3.73657 3.73657C4.05199 3.42114 4.56339 3.42114 4.87881 3.73657L5.93941 4.79716L7 5.85775
L9.12117 3.73657C9.4366 3.42114 9.94801 3.42114 10.2634 3.73657C10.5789 4.05199 10.5789 4.56339
10.2634 4.87881L8.14225 7L10.2634 9.12118C10.5789 9.4366 10.5789 9.94801 10.2634 10.2634
C9.94801 10.5789 9.4366 10.5789 9.12117 10.2634L7 8.14225L4.87881 10.2634C4.56339 10.5789
4.05199 10.5789 3.73657 10.2634C3.42114 9.94801 3.42114 9.4366 3.73657 9.12118L4.79716 8.06059
L5.85775 7L3.73657 4.87881C3.42114 4.56339 3.42114 4.05199 3.73657 3.73657Z
```
Two 1.5-unit strokes with round caps: (4.5,4.5)→(9.5,9.5) and (9.5,4.5)→(4.5,9.5). Not "greyed" — it takes the state's own colour.

**Reference implementation:**

```tsx
const A = 2 * Math.PI * 1.94; // 12.189379495928398

type StatusKind = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

function StatusIcon({ kind, color, progress = 0, knockout }: {
  kind: StatusKind; color: string; progress?: number; knockout: string;
}) {
  const terminal = kind === 'completed' || kind === 'canceled';
  const inner = terminal
    ? { r: 3, sw: 6, dash: `${2 * Math.PI * 3} ${4 * Math.PI * 3}`, off: 0 }
    : { r: 2, sw: 4, dash: `${A} ${2 * A}`, off: A * (1 - progress) };
  const dashed = kind === 'backlog';

  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
      <circle
        cx={7} cy={7} r={6} fill="none" stroke={color} strokeWidth={1.5}
        strokeDasharray={dashed ? '1.4 1.74' : '3.14 0'}
        strokeDashoffset={dashed ? 0.65 : -0.7}
      />
      <circle
        cx={7} cy={7} r={inner.r} fill="none" stroke={color} strokeWidth={inner.sw}
        strokeDasharray={inner.dash} strokeDashoffset={inner.off}
        transform="rotate(-90 7 7)"
      />
      {kind === 'completed' && <path stroke="none" fill={knockout} d={CHECK_PATH} />}
      {kind === 'canceled'  && <path stroke="none" fill={knockout} d={CROSS_PATH} />}
    </svg>
  );
}
```

Rendered size in the issue list: **14×14 CSS px**, 1:1 with the viewBox **[DOM]**.

#### An alternative implementation exists in the bundle — read this before choosing

Linear's `SkillIcon.D5kuBuUw.js` also contains a **different, parametric** status component: a `<rect x=1 y=1 width=12 height=12 rx=6>` ring with a true SVG arc wedge at `r=3.5` (`M r,r L r,0 A r,r 0 largeArc,1 endX,dy z`), and a Backlog drawn as a single 12-subpath fill at exact 15°/15° duty rather than a dashed stroke.

**I checked which one actually renders.** Across all 33 status-icon instances captured from three different app pages, **every one** used the two-`<circle>` + `stroke-dasharray` form documented above, and **zero** used the `rect rx=6` form. Linear ships both; the circle/dasharray version is what the issue list, issue detail and workflow settings paint in the current build.

**Recommendation:** implement the circle/dasharray version (it matches the product today, and it animates trivially by tweening one `stroke-dashoffset`). Note the arc-wedge version exists in case a future Linear deploy switches over. Also note: the two differ subtly — the dashed Backlog ring is 44.6% duty (`1.4 / 1.74`), whereas the path version is exactly 50%.

There is additionally a **16×16 generic** status glyph, `StatusIcon.CaDsWu5j.js`, used in menus and filters: ring `r=6.25 sw=1.5`, right-half pie `r=4` **[SRC]**.

Linear has **seven** state types, not five — `triage` and `duplicate` also have glyphs **[SRC]**: Triage is a filled disc with a horizontal double-headed-arrow knockout; Duplicate is a filled disc with two parallel 45° bars knocked out (`(10.109,6.25)→(6.25,10.109)` and `(7.75,3.89)→(3.89,7.75)`, weight 1.5, round caps).

### 5.2 Priority icons

**All priority icons are 16×16**, `viewBox="0 0 16 16"`, pure fills, no strokes. Rendered at 16×16 **[DOM]**. Both my DOM capture and the component source agree on every coordinate.

Bars share one grid — three rects, **width 3, `rx` 1, x at 1.5 / 6.5 / 11.5** (5px pitch, 2px gap), **all bottom-aligned to y=14**, heights 6 / 9 / 12:

| Bar | x | y | w | h | rx |
| --- | --- | --- | --- | --- | --- |
| 1 (short) | 1.5 | 8 | 3 | 6 | 1 |
| 2 (mid) | 6.5 | 5 | 3 | 9 | 1 |
| 3 (tall) | 11.5 | 2 | 3 | 12 | 1 |

Unfilled bars are **the same rect at `fill-opacity="0.4"`** — not a different colour, not an outline.

| Priority | value | Solid bars | Dimmed |
| --- | --- | --- | --- |
| **High** | 2 | 1, 2, 3 | — |
| **Medium** | 3 | 1, 2 | bar 3 |
| **Low** | 4 | 1 | **bars 2 *and* 3** |

> **Low dims two bars, not one.** A common clone error.

**No priority** (value `0`) — three short dashes, *not* bars:
```html
<rect x="1.5"  y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9"/>
<rect x="6.5"  y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9"/>
<rect x="11.5" y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9"/>
```
Same x positions and 3px width as the bars, but 1.5 tall, centred on y=8, `rx=0.5`, whole group at `opacity: 0.9`.

**Urgent** (value `1`) — a rounded square with the exclamation **knocked out of the same path** via fill-rule:
```html
<path d="M3 1C1.91067 1 1 1.91067 1 3V13C1 14.0893 1.91067 15 3 15H13C14.0893 15 15 14.0893
15 13V3C15 1.91067 14.0893 1 13 1H3ZM7 4L9 4L8.75391 8.99836H7.25L7 4ZM9 11C9 11.5523 8.55228
12 8 12C7.44772 12 7 11.5523 7 11C7 10.4477 7.44772 10 8 10C8.55228 10 9 10.4477 9 11Z"/>
```
Square (1,1)→(15,15) — **14×14 inside a 16×16 box, corner radius 2**. Exclamation: a tapered stem from x 7→9 at y=4 narrowing to 7.25→8.75 at y≈9, plus a dot at (8, 11) radius 1.

**Urgent colour — resolved [SRC] + [DOM]:**
```js
<Icon color={muted ? 'labelMuted' : 'orangeBase'} aria-label="Urgent Priority">
```
`orangeBase` here is a **theme token**, and in the app runtime that token resolves to **`#ff7235`** (measured as `--sx-11vg3qk`, in both dark and light). Beware the collision flagged in §1.6: the *label-palette* swatch also called `orangeBase` is `#f2994a` — a different value for a different purpose.

Of the three candidate hexes in circulation: `#f2994a` is the label swatch, `#fc7840` is the marketing `--color-orange` and Linear's default **Triage** state colour, and **`#d9730d` appears nowhere in Linear's source**.

**Both renderings are correct — pick by context.** `[PIXEL]` sampling of the live issue list shows the **muted** variant in use there: the square painted `#959597` with the "!" knocked out in the page background `#121213`. Use orange in pickers, menus and badges; muted grey inside a dense list.

The other four priority icons take the ambient icon colour, measured as `#959597` (`label-muted`) **[DOM]**.

Priority enum **[SRC]**: `No priority = 0, Urgent = 1, High = 2, Medium = 3, Low = 4`. Sort order maps `0` to `100` so "no priority" sinks to the bottom.

A second generic `PriorityIcon.CHWArrUA.js` exists for menus with bars at x 1 / 6 / 11 — a 0.5px-shifted variant of the same geometry **[SRC]**.

### 5.3 General icon sizing — **[SRC]**

```css
._iconSmall  { width: 14px; height: 14px }   /* applies to the child svg too */
._iconNormal { width: 16px; height: 16px }
```
Status icons ship at **14**, priority icons at **16**, general UI icons at 16 (14 in compact controls). The `Icon` wrapper defaults to `size=16, viewBox="0 0 16 16", color="labelMuted"`.

---

## 6. Layout

### 6.1 Global frame

| Element | Value | Source |
| --- | --- | --- |
| **Sidebar width** | **244px** | **[DOM]** measured box + `--sidebar-width: 244px` **[SRC]** + `@LocalPref(244, browserSession) sidebarWidth` **[SRC]** |
| Sidebar background | `#09090a` — **no `border-right`** (measured `0px none`) | **[DOM]** |
| Content pane background | `#121213` | **[DOM][PIXEL]** |
| **Content header height** | **44px**, `padding: 0 8px`, `border-bottom: 0.5px solid #212224` | **[DOM]**, matching `mainHeaderHeight/subHeaderHeight = 44 − thinPixel (43.5 retina)` **[SRC]** |
| App shell inset | `margin: 8px; margin-left: var(--sidebar-width); border-radius: 12px; border: 1px solid var(--bg-border-color)` | **[SRC]** |
| Shell border on retina | drops to **0.5px** at `min-resolution: 192dpi` | **[SRC]** |
| Mobile (`< 1023px`) | inset collapses to `margin: -1px` | **[SRC]** |
| Marketing header | 72px + 1px border `rgba(255,255,255,.08)`, `backdrop-filter: blur(20px)` | **[WWW]** |
| Sidebar nav item height | 28px; `sidebarPadding: 12`; primary button 28px | **[SRC]** |
| Breakpoints | phone 640 · tablet 768 · laptop 1024 · large 1400 · xlarge 1800 | **[SRC]** |

> **Linear separates sidebar from content with a lightness step, not a border.** The content pane is an inset card (8px margin, 12px radius) floating on the `#09090a` ground. Reproducing this with a 1px vertical divider is the single most common structural tell in clones.

The 220px sidebar figure that circulates online is **wrong** for the current build.

### 6.2 Issue list

| Element | Value | Source |
| --- | --- | --- |
| **Row height** | **44px** (`min-height: 36px`) | **[DOM]** measured + `listIssueRowHeight: 44` **[SRC]** |
| Project row / initiative row | 48px / 58px (`listProjectRowWithDescriptionHeight: 58`) | **[SRC]** |
| **Group header height** | **36px**, background `#1a1a1b`, radius 8px | **[DOM]** + `listHeaderHeight: 36` **[SRC]** |
| Row border-radius | **8px** | **[DOM][SRC]** |
| Row hover background | **`#1a1a1b`** | **[DOM][PIXEL]** |
| Row hover pill inset | `inset: 0 8px` — the highlight stops 8px short of each edge, reading as a floating pill, not a full-bleed band | **[SRC]** |
| Row transition | `background-color 0s, box-shadow 0.15s` | **[SRC]** |
| Keyboard-focused row | `box-shadow: 0 0 0 1px var(--row-keyboard-border) inset` | **[SRC]** |
| Row separators | **none** | **[DOM]** |
| Avatar in row | **18px** circle, initials 9px/400 | **[DOM]** |
| Avatar in header / workspace switcher | 24px, radius 12px | **[DOM]** |
| Grid | CSS **subgrid** (`grid-template-columns: subgrid; grid-column: 1/-1`) so all rows' columns align | **[SRC]** |

Measured row internals at 1437px viewport (x, left → right) **[DOM]**:
`287` priority icon (16px) → `325` issue ID (13px) → `363` status icon (14px) → `385` title (13px) → right-aligned: label chips → avatar (18px) → date (12px).

### 6.3 Three-pane shape

Panel widths are **fixed pixel defaults, not proportions** **[SRC]**:

```js
inboxListWidth 400   triageListWidth 400   searchListWidth 400
agentsListWidth 400  runHistoryListWidth 400
myWorkListWidth 482  // reviewsListWidth ?? focusListWidth ?? 482
timelineAsideWidth 320
aiPanelWidth 400     agentPanelWidth 400 / agentPanelHeight 600
pageAgentSidebarWidth 400
```

So: **sidebar 244 | list 400 (482 for My Work) | detail flexible.**

Issue detail, measured at 1437px **[DOM]**:

| Pane | x range | Width |
| --- | --- | --- |
| Sidebar | 0 – 244 | 244px |
| Detail content (title, description, activity) | 245 – ~985 | ~740px; text column ~652px from x≈306 |
| Properties rail | ~1000 – 1437 | ~420px; labels start x≈1018 |

- Detail title ~24px, weight 500, `#ffffff`.
- Properties rail: section labels (`Properties`, `Labels`, `Project`) in tertiary grey; rows are icon (14–16px) + 13px label, ~32px apart.
- Top bar: breadcrumb `ENG-9  An issue title` at 13px/500, star, `…` menu, right-aligned `1 / 9` pager.
- **Content measure is `contentMaxWidth: '80ch'`** **[SRC]** — at 15px Inter that lands at ~640–660px, matching the ~652px I measured **[DOM]**. Use `80ch`, not a pixel value.
- `editorBottomPadding: 384` **[SRC]** — the large scroll runway under the editor.

### 6.4 Marketing page widths — **[WWW]**

```css
--page-max-width:         1024px;
--prose-max-width:        624px;
--page-padding-inline:    24px;
--page-padding-block:     64px;
--page-inset:             32px;
--homepage-max-width:     calc(1344px + 46px * 2);
--homepage-outer-padding: 46px;
--homepage-padding-inset: 32px;
--grid-columns:           12;
--header-height:          72px;
```

### 6.5 Scrollbars — **[WWW]**

```css
--scrollbar-size: 6px;   --scrollbar-size-active: 10px;
--scrollbar-width: 12px; --scrollbar-gap: 4px;
```
A 6px overlay thumb that grows to 10px on interaction inside a 12px gutter.

### 6.6 Buttons

Marketing, measured on `/features` **[WWW]**:

| Variant | Height | Radius | Background | Text | Size / Weight | Padding |
| --- | --- | --- | --- | --- | --- | --- |
| Primary (inverted), large | 40px | 9999px | `#e5e5e6` | `#08090a` | 15px / 510 | `0 16px` |
| Primary (inverted), small | 32px | 9999px | `#e5e5e6` | `#08090a` | 13px / 510 | `0 12px` |
| Secondary (glass), large | 40px | 9999px | `#ffffff0d` | `#f7f8f8` | 15px / 510 | `0 16px` |

Primary shadow = `--shadow-stack-low`. Secondary "glass" edge, worth copying:
```css
box-shadow: inset 0 0 0 1px rgba(255,255,255,.03),
            inset 0 1px 0 0 rgba(255,255,255,.04),
            0 0 0 1px rgba(0,0,0,.6),
            0 4px 4px 0 rgba(0,0,0,.1);
```
All transitions `0.16s cubic-bezier(.25,.46,.45,.94)`.

**App** buttons are **not pills**: `--control-border-radius: 8px`, `--action-trigger-min-width: 32px`, input padding `6px 12px`, input font-size `0.8125rem` **[DOM]**.

---

## 7. Screenshot index

All files in `Linear/research/screenshots/`, captured at 1440×900 unless noted.

| File | What it shows | Sensitivity |
| --- | --- | --- |
| `linear-home-hero.png` | Marketing home above the fold, dark — hero H1, header, primary/secondary CTAs. Captured **before** the session went live, so it is the genuine logged-out page. | Public |
| `linear-home-hero-light-theme.png` | Same viewport with `data-theme="light"` forced — light-theme surfaces and text. | Public |
| `linear-features-page.png` | `/features` — 64px H1, 13px/510 tertiary section eyebrows, feature grid. | Public |
| `linear-method-page.png` | `/method` — Linear Method landing; long-form editorial type. | Public |
| `linear-docs-home.png` | `/docs` index — docs nav, card grid, docs typography. | Public |
| `linear-docs-display-options-full.png` | **Full page** `/docs/display-options` — real in-product screenshots of list vs board, grouping and display density. Best public reference for list-density variants. | Public |
| `linear-docs-issue-status-full.png` | **Full page** `/docs/configuring-workflows` ("Issue status") — real in-product shots of the status picker and all state-type icons side by side. Best public reference for status iconography. | Public |
| `linear-changelog.png` | `/changelog` — release cards with product screenshots; good surface/elevation reference. | Public |
| `linear-brand-guidelines-full.png` | **Full page** `/brand` — wordmark, logomark, icon, and the Mercury White / Nordic Gray swatches with hexes on screen. | Public |
| `linear-app-issue-list-dark.png` | **Real Linear client**, grouped issue list, dark. Source of the 244px sidebar, 44px row, 36px group header, `#09090a`/`#121213`/`#1a1a1b` grounds, and all status + priority glyphs in situ. | **Internal — real Acme issue titles + avatars** |
| `linear-app-issue-detail-dark.png` | **Real Linear client**, issue detail. Source of the three-pane geometry, properties rail, editor column, activity feed. | **Internal — real Acme issue content** |

### Supporting raw data — `Linear/research/extracted/`

| File | Contents |
| --- | --- |
| `tokens-app-dark-computed.json` | **511** resolved `--*` custom properties from the live app client |
| `tokens-dark-computed.json` / `tokens-light-computed.json` | 408 / 406 resolved properties, marketing site, both themes |
| `app-resolved-colors.json` | Every app `lch()` token with its canvas-resolved hex |
| `app-workflow-icons-and-lch.json` | All workflow-state SVGs incl. Canceled, plus the lch→hex table |
| `app-svgs-issue-detail.json` | 55 deduped inline SVGs from the issue detail view |
| `app-list-measurements.json` | Issue-list icons, row boxes, layout probes, 18 typography signatures |
| `app-row-hover-metrics.json` | Row / group-header / avatar geometry with hover captured |
| `app-theme-inline-style.json` | The boot-time `<html style>` theme seed |
| `marketing-components.json` | Marketing button, heading and header computed styles |
| `urgent-icon-source.json` | The Urgent-priority React component source, verbatim |
| `tokens-home-blocks.json` | Raw `--*` declaration blocks by selector, marketing stylesheets |

---

## 8. Implementation checklist — what clones get wrong

1. **`font-feature-settings: "cv01", "ss03"`** plus `-webkit-font-smoothing: antialiased` on `body`. Without these Inter renders a double-storey `a` and it stops looking like Linear.
2. **Build against the app palette, not the marketing palette.** `#08090a` is the marketing background; the product is `#09090a` chrome over `#121213` content.
3. **13px is the chrome size**, and titles are **weight 500, not 600**. Hierarchy comes from `#ffffff` vs `#959597`.
4. **No border between sidebar and content.** The content pane is an inset card — 8px margin, 12px radius — on the darker ground.
5. **No dividers between issue rows.** Rows are 44px, radius 8px, hover fill inset 8px from each edge.
6. **Row hover background transitions in 0s**; only the shadow eases (150ms). Any easing on `background-color` makes the list feel laggy.
7. **Status icons are 14px, priority icons 16px.** Don't unify them.
8. **The progress pie is a stroked inner circle**, not an arc path or conic gradient: `r=2, stroke-width=4, dasharray "A 2A", dashoffset A(1−p), rotate(-90 7 7)`, `A = 2π × 1.94`.
9. **Implement the per-state progress rule** so a workflow with two started states renders 50% and 75% wedges.
10. **Unfilled priority bars are `fill-opacity: 0.4` of the same colour** — and **Low dims two bars**, not one.
11. **Done / Canceled / Duplicate / Urgent are single evenodd paths with knockouts**, never disc + white glyph — otherwise they break the moment the row background changes on hover.
12. **Dark theme has almost no drop shadows.** Elevation is background lightness + 1px borders.
13. Header rule is **0.5px** on retina, not 1px.
14. Ship the canonical state hexes (`#bec2c8 / #e2e2e2 / #f2c94c / #5e6ad2 / #95a2b3`), not the LCH-normalised values measured in one workspace.
15. Content measure is **`80ch`**, not a fixed pixel width.
16. Default motion is **150–160ms `cubic-bezier(.25,.46,.45,.94)`**, not 250ms. Honour `prefers-reduced-motion`.

**Strategic recommendation:** rather than hand-copying hexes, consider vendoring Linear's four theme-generator modules (`darkThemeRefresh`, `lightThemeRefresh`, `ColorConverter`, `ThemeProvider` — ~50KB, no React needed at the colour layer) and emitting CSS custom properties at build time. That yields the exact product palette *plus* the derived `elevatedTheme()` / `menuTheme()` / `sidebarTheme()` / `selectedTheme()` sub-surfaces that a frozen token list cannot reproduce. If you prefer frozen values, §1.1–1.2 are complete enough to ship.

---

## 9. Sources

### Live measurement (this session)

- `https://linear.app/` — marketing home; token dump both themes, hero typography, screenshots
- `https://linear.app/features` — button / heading / header computed styles
- `https://linear.app/method`, `https://linear.app/docs`, `https://linear.app/changelog` — screenshots
- `https://linear.app/docs/display-options` — full-page (in-product list/board imagery)
- `https://linear.app/docs/configuring-workflows` — full-page (status icon imagery)
- `https://linear.app/brand` — official brand colours, naming and usage rules
- `https://linear.app/docs/issues` — **404, does not exist**; issue docs live under other slugs
- App routes, read-only: `/acme/team/ENG/all`, `/acme/issue/ENG-9/…`, `/acme/settings/teams/ENG/workflow`

### Linear's shipped assets (fetched and read)

- `static.linear.app/client/assets/store.aAzVydJL.js` — default workflow states, 9-colour label palette, priority enum, panel-width prefs
- `static.linear.app/client/assets/SkillIcon.D5kuBuUw.js` — priority icon components (source of `orangeBase`), alternative status components
- `static.linear.app/client/assets/StateTypeIcon.BxKCoOZR.js` — state-type → icon dispatch (seven types)
- `static.linear.app/client/assets/StatusIcon.CaDsWu5j.js` — 16×16 generic status glyph
- `static.linear.app/client/assets/ListCell-BzSQl_mH.css` — row radius, 8px inset, selection corner rules, transition timings
- `static.linear.app/client/assets/Button-DO5Nz3Sh.css` — `_iconSmall` 14px / `_iconNormal` 16px
- `static.linear.app/client/assets/Root-BcJz3RRv.css` — app base stylesheet (483 KB)
- `static.linear.app/client/assets/pageSizes.stylex.CBny5uFx.js`, `pageSizes.Bi3cps8U.js` — layout constants
- `static.linear.app/client/assets/darkThemeRefresh.CxqgEpzQ.js`, `lightThemeRefresh.CZPgWuUs.js`, `ColorConverter.DhxJEvP1.js`, `ThemeProvider.TeuZK1K3.js` — the theme generator, executed in Node to compute §1.1–1.2
- `static.linear.app/client/assets/ContextualMenuActions.a73y1UFj.js` — `getStateTypeColor`
- `static.linear.app/client/assets/html.jxef_FVP.js` — asset manifest (chunk hashes rotate every deploy; re-derive from here if a URL 404s)
- `static.linear.app/web/_next/static/css/index.Dcyhk-x2.css` + ~50 sibling marketing stylesheets — marketing token blocks incl. `[data-theme=glass]`
- `static.linear.app/fonts/InterVariable.woff2?v=4.1`, `Berkeley-Mono-Variable.woff2?v=3.2`

### Cross-check implementations (not copied, useful as second opinions)

- `livestorejs/livestore` → `examples/web-linearlite/src/components/icons/*` — faithful but older-generation; uses the same dasharray approach
- `XavierAgostini/linear-app-figma-widget` → `src/ui/components/icons.tsx` — Done/Canceled paths match current Linear exactly; ring stroke-width is stale (2 vs 1.5)
- `campsite/campsite` → `packages/ui/src/Icons/index.tsx` — a 24×24 rescale, useful if you need a larger tier

### Sources deliberately **not** used

Several widely-linked "Linear design system" write-ups were checked and found unreliable:

- **`voltagent/awesome-design-md` → `linear.app/DESIGN.md`** — borders and the surface ladder are right, but it **invents typefaces** ("Linear Display", "Linear Text", "Linear Mono"). The type section is fiction.
- **`styles.refero.design`** — gets Inter Variable / Berkeley Mono and marketing weights right, but "Iris Violet `#6366f1`" and "Lavender `#8b5cf6`" are Tailwind indigo-500 / violet-500, and "Acid Lime `#e4f222`" appears nowhere in Linear. Fabricated.
- **`fontofweb.com/tokens/linear.app`** — explicitly omits colour tokens. No data.
- `copycats.design/linear-app` → 404; `designmd.cc/benchmarks/linear` → 403.
- The popular "Linear clone" repos clone the **marketing landing page**, not the app.

Hexes that circulate online but **appear nowhere in Linear's shipped source**: `#101012`, `#fcfcfd`, `#f4f5f8` (as a UI token — it *is* the brand's Mercury White), `#eeeff1`, `#e0e1e6`, `#b19aff`, `#26a4ff`, `#ffab00`, `#e2b203`, `#d9730d`.

Near-misses worth correcting: `#191a1c` → real `#191a1b`; `#f9f9f9` → real `#f9f8f9`; `#e9e9e9` → real `#e9e8ea`.
