# Design tokens extracted from the live sites

Captured 2026-08-09 by evaluating `document.styleSheets` on kalshi.com and polymarket.com
via Playwright. These are **confirmed** values read out of the shipped CSS, not guesses.
Raw dumps: `screenshots/kalshi-tokens.json`, `screenshots/polymarket-tokens.json`,
`screenshots/polymarket-geometry.json`.

## Kalshi (kalshi.com)

Font stack: `kalshiSans` (custom grotesk) with `kalshiCondensed`, `kalshiSansMedium`,
`graphikCompact`, `graphikWideSemibold`, `ooTheranLight` as companions.
Substitute: **Inter / Geist** for body, a condensed grotesk for numerics.

### Surfaces (dark)
| Token | Value | Role |
|---|---|---|
| `--surface-x10` | `#0a0c0f` | page background (near-black, cool) |
| `--surface-x20` | `#13161a` | card background |
| `--surface-x30` | `#1b2029` | raised / hover card |
| `--surface-x40` | `#333333` | highest elevation |
| `--surface-overlay` | `#00000080` | modal scrim |

### Brand + semantics
| Token | Value | Role |
|---|---|---|
| `--brand-primary` | `#28cc95` | Kalshi mint — primary CTA, logo, active nav |
| `--brand-secondary` | `#00412b` | deep green, brand fills |
| `--green-x10` | `#39bf5b` | Yes / up |
| `--green-x20` | `#39bf5b29` | Yes tinted background (16% alpha) |
| `--green-x30` | `#39bf5b52` | Yes border (32% alpha) |
| `--red-x10` | `#ff409f` | No / down — **note Kalshi's "red" is magenta-pink** |
| `--red-x20` | `#ff409f29` | No tinted background |
| `--blue-x10` | `#36b0d9` | second chart series |
| `--orange-x10` | `#ff9500` (from `--orange-x20` alpha base) | third chart series |
| `--purple-x10` | `#b266ff` | fourth series |
| `--yellow-x10` | `#ffe14d` (alpha base) | warning |
| `--special-gold` | `#e5bd45` | leaderboard 1st |
| `--special-silver` | `#98a7b2` | 2nd |
| `--special-bronze` | `#b28474` | 3rd |

Pattern worth stealing: every accent ships as a **quad** — solid `x10`, 16%-alpha fill
`x20`, 32%-alpha stroke `x30`, and lighter tints `x40`/`x50`. That's exactly what the
outlined percentage pills use (transparent fill, `x30` border, `x10` text).

### Text / stroke ramps (alpha-on-white, not solid greys)
`--text-x10 #ffffffe6` (90%), `--text-x20 #ffffff99` (60%), `--text-x30 #ffffff73` (45%).
`--stroke-x20 #ffffff57`, `--stroke-x30 #ffffff3d`, `--stroke-x40 #ffffff29`.
Using alpha rather than solid greys is why cards at different elevations still read
consistently. **Adopt this.**

### Layout
| Token | Value |
|---|---|
| `--content-width` | `1320px` |
| `--top-navbar-height` | `107px` (two rows: 64px bar + ~43px category row) |
| `--trader-drawer-width` | `360px` (right rail), `300px` at lg |
| shadow | `0 0 12px #ffffff24, 0 12px 24px #0006` |

## Polymarket (polymarket.com)

Font stack: **Inter** (with `cv01 cv02 cv03 cv04 cv11 cv15` feature settings, `cv09` off),
`Geist Mono` for numerics, `Suisse Intl` + `openSauce` for display.
Design system is namespaced `[data-theme="dark"] [data-polykit]`.

### Grey ramp (dark)
`50 #0a0b10` · `100 #17181c` · `200 #202227` · `300 #25262d` · `400 #2c2e35` ·
`500 #4e525f` · `600 #80838e` · `700 #8d909a` · `800 #9b9da7` · `900 #ecedee`

### Semantic mapping (this is the important part)
```
--color-surface        = gray-50   #0a0b10   page
--color-grouped        = gray-100  #17181c   card
--color-elevated       = gray-100  #17181c   popover
--color-overlay        = alpha-black-600 (#00000091)
--color-primary        = gray-900  #ecedee   primary text
--color-secondary      = gray-800  #9b9da7   secondary text
--color-tertiary       = gray-500  #4e525f   muted text
--color-element-bg     = gray-100 / -2 gray-200 / -3 gray-300
--color-element-border = gray-200 / -2 gray-300 / -3 gray-400
--color-accent-bg      = gray-600 / -2 gray-700
```

### Accents (dark)
| Ramp | 600 (solid) | 700 | 900 (tint text) | 100/200 (tinted bg) |
|---|---|---|---|---|
| blue | `#4877ff` | `#5b88ff` | `#e5ebff` | `#071440` / `#0a1c5c` |
| green (Yes) | `#2bae4c` | `#2fbb53` | `#bff8cd` | `#051a0a` / `#07270f` |
| red (No) | `#f43437` | `#f55b55` | `#fee7e7` | `#350304` / `#490405` |
| yellow | `#efc500` | `#face00` | `#ffeb99` | `#1f1800` |
| purple | `#a261e1` | `#ab75e4` | `#f0e6fa` | `#230b37` |
| magenta | `#ee2ba6` | `#f84ab2` | `#fde3f3` | `#2f041f` |
| teal | `#0595b3` | `#09a3c3` | `#bef3fd` | `#01191e` |

Yes/No buttons use the **200-level tinted background + 700-level text**, going to the
600-level solid on hover — a low-contrast resting state that pops on intent.

### Geometry (measured at 1440×900)
- Card grid: **4 columns**, card width **346px**, grid gap **16px**, content max ~1448px
- Card radius **11.2px** (0.7rem), inner gap 8px, section gap 12px
- Card heights: 136px (compact 2-row) / 184px (3-row) / 219px (with header block)
- Base font 16px, Inter 400/500/600

## Synthesis for Bet

Bet's own identity should read as a third thing — not a Kalshi clone, not a Polymarket
clone — while the `/explore` surface deliberately mixes both (per the brief).

Recommendation:
- **Base surfaces from Polymarket's cool near-black ramp** (`#0a0b10` page / `#17181c`
  card) — it's the more neutral of the two and composes better with a custom accent.
- **Alpha-based text/stroke ramps from Kalshi** — more robust across elevations.
- **Bet accent: a warm violet/electric-indigo** so friend-space (Bet) and public-space
  (Explore) are instantly distinguishable; Explore keeps green/red Yes/No which both
  sources share.
- **Yes/No: Polymarket's tinted-bg + colored-text resting state**, since it is the more
  legible pattern at card density.
- **Percentage pills: Kalshi's outlined pill** (transparent fill, 32%-alpha border,
  solid text) — used everywhere a probability is shown.
- Radius 12px on cards, 999px on pills, 8px on inputs. Grid gap 16px, content 1320px.
