# Kalshi (kalshi.com) — Specification-Grade UX/Visual/Mechanics Writeup

Researched 2026-08-09. Confidence is marked per-item: **[CONFIRMED]** = read directly from
Kalshi's shipped CSS custom properties (`document.styleSheets`, captured via Playwright in
`screenshots/kalshi-tokens.json` in this same research folder), from Kalshi's own help
center / API docs, or observed pixel-for-pixel in official App Store screenshot assets.
**[OBSERVED]** = seen in a real screenshot of the live app but not cross-checked against
source. **[INFERRED]** = my best reconstruction from partial evidence (naming, visual
similarity, third-party descriptions) — flagged explicitly, do not treat as exact.

Note on access: kalshi.com serves a Vercel bot-detection "Security Checkpoint" challenge
to headless browsers/curl/proxies, so this pass could not re-drive the live site directly.
It relies on (a) a prior session's live CSS-variable extraction already sitting in this
research folder (`design-tokens-extracted.md`, `screenshots/kalshi-tokens.json`), which
pulled straight from the site's stylesheets and is authoritative; (b) five official Apple
App Store marketing screenshots (real in-app UI, not mockups) fetched directly from Apple's
CDN and inspected pixel-by-pixel; and (c) Kalshi's own help center, API docs, and press
coverage.

---

## 1. Information architecture

### 1.1 Top nav
**[INFERRED / partially confirmed]** Confirmed items exist as real surfaces: **Markets**
(home/browse), **Perps** (`kalshi.com/perpetuals`, crypto perpetual futures — separate
product, its own purple accent `--perps-purple-x10 #ae88ff`), **Pro** (`kalshi.com/pro`, a
desktop multi-pane trading terminal — "cockpit for predictions and perpetuals," live
book/chart/order-ticket per market, keyboard-driven), **Live** (a sports-specific hub
surfacing in-progress games with live score, live chart, live chat — seen directly in-app,
§3), and **More** (overflow menu). CSS confirms a fixed two-row header:
`--top-navbar-height: 107px` = a ~64px primary bar + a ~43px category row beneath it,
plus optional `--announcement-height` / `--top-banner-height` banner slots (0px by default).

### 1.2 Category row
**[CONFIRMED via search]** Trending, Elections, Politics, Sports, Culture, Crypto,
Commodities, Climate, Economics, Mentions, Finance, Tech & Science — appear as first-class
category landing pages, e.g. `kalshi.com/category/climate/daily-temperature`,
`kalshi.com/category/sports/tennis/all/events`. "Mentions" covers markets on whether a
named person/entity will say or do something (media-mention markets). These sit in the
43px sub-row of the header, horizontally scrollable, tab-styled (active tab bold white,
inactive tabs `--fill-x40`/muted gray) — pattern confirmed in-app as segmented counts, e.g.
`ALL 52 · SPORTS 25 · CRYPTO 10 · FINANCIALS …` **[OBSERVED, App Store shot 1]**.

### 1.3 Search & account menu
**[INFERRED]** Not directly observed this pass; standard pattern for the category is a
search icon opening a command-palette-style overlay, and a right-aligned avatar/hamburger
menu. The in-app hamburger (≡) icon sits top-left next to the wordmark on mobile
**[OBSERVED]**; on a market detail page the top-right cluster is `···` (more) →
share/upload icon → comment-count bubble (`1.1k`, `169k`, `90`, colored mint green)
**[OBSERVED, App Store shots 2, 4, 5]**.

### 1.4 Homepage section structure
**[OBSERVED, App Store shot 1 — home feed]**, top to bottom:
1. Wordmark (mint green "Kalshi") + hamburger, then the category tab row with live counts.
2. **Hero event card** — full-width, dark elevated card (`--surface-x20 #13161a`) with a
   colored left-edge glow/border matching the event's theme color (red-tinted for a US
   Elections card observed), centered icon (e.g. a small flag/emoji-style square icon),
   headline title ("2026 US Elections"), and a muted total-volume line ("$496,816,868 Total
   vol"). Reads as a single big promoted-event tile, not a carousel item.
3. **"Happening now" section** — bold section header + a **COMBO** pill button top-right
   (dark rounded pill with a small multi-diamond/link icon, indicates parlay-style combo
   markets are filterable/orderable from this rail). Below it, a vertical stack of live
   market cards (see §2) — the brief's "Motorsport / Tennis / Daily Temperature" rows read
   as further named category carousels/sections following this same "Happening now"
   pattern, one section per topic, each horizontally scrollable on the row itself while the
   page scrolls vertically.
4. Right rail (desktop) — **[INFERRED from brief + standard pattern, not re-confirmed this
   pass]** promo/referral cards, a "Trending" mini-list, and a "Customize your view" module
   (widget/category picker letting a signed-in user pin categories to their feed). Layout
   CSS confirms a dedicated `--trader-drawer-width: 360px` (300px at large breakpoints) —
   this token's name suggests it's shared with the order-ticket drawer on market-detail
   pages, i.e. the same fixed-width right-rail slot is reused for "browse" promo content on
   the homepage and for the Yes/No order ticket on a market page.
5. Content max width: `--content-width: 1320px` **[CONFIRMED]**.

---

## 2. Market card anatomy

**[OBSERVED directly, App Store shot 1]** — a two-outcome ("Kozlov vs Pascual Ferra")
sports card, annotated:

- **Category icon** — small square logo chip, top-left (e.g. ATP tour logo), ~24–28px.
- **Category label** — all-caps muted gray label immediately right of the icon
  ("TENNIS").
- **Series/tournament label** — right-aligned on the same row, muted gray, smaller/lighter
  weight ("ATP Challenger Bloomfield Hills").
- **Title** — bold white line below, the actual matchup/question ("Kozlov vs Pascual
  Ferra").
- **Timestamp / LIVE badge** — directly under the title: either a plain gray timestamp
  ("Today @ 12:15pm EDT") or, for in-progress markets, a small red/pink dot + bold
  "LIVE" label in the same red/pink accent used for the "No" side (`--red-x10 #ff409f`),
  observed on a second stacked card in the same shot.
- **Per-outcome rows** — one row per side:
  - flag/avatar icon (24px circle or small flag rect) + outcome name, name underlined in
    that outcome's assigned color (mint-green underline for the row's "leading"/first
    outcome, red/pink for the other) — this underline is the same color used for that
    outcome's line on the price-history chart, i.e. outcome→color mapping is consistent
    between card and detail chart.
  - inline numeric context specific to the market type — here, live match score columns
    ("4 4", "6 6" — sets won) sit between the name and the percentage.
  - **percentage chip** — a pill, transparent/very-dark fill with a colored outline and
    colored bold text, mint-green outline+text for the "in favor" side (e.g. "24%"), red/
    pink outline+text for the other ("76%"). This is the "outlined pill" pattern: no solid
    fill, ~1.5–2px colored stroke, fully rounded (pill/999px radius) ends, generous
    horizontal padding.
  - a payout-multiplier read (the brief's "1.50x" style) is the reciprocal framing of the
    same percentage — **[INFERRED]** not seen directly in these five screenshots; Kalshi's
    contracts pay $1 per contract so multiplier = 1/price, and third-party odds sites
    (OddsShopper, KalshiView) consistently describe Kalshi's own UI as percentage-first
    rather than multiplier-first, so the "x" multiplier is more likely a secondary/toggle
    display than the primary one — flag this as needing live confirmation.
- **Footer row** — small icon (looks like the combo/link glyph reused from the section
  header) + volume text in muted gray, dollar-formatted with "vol" suffix
  ("$1,126,533 vol").
- **"N markets" / "N more" affordance** — **[INFERRED from brief, not directly observed]**
  — for multi-outcome events the card likely truncates to a few top rows plus a "+N more"
  expander, consistent with how the detail page's own "Markets" table (§3) lists every
  bracket/candidate as a row with independent Yes/No pills.
- **Bookmark icon** — **[INFERRED from brief]** — not visible in the five captured crops;
  standard placement would be top-right of the card, opposite the category icon.
- Card surface: `--surface-x20 #13161a` on `--surface-x10 #0a0c0f` page background, ~12–16px
  radius, thin 1px hairline border in a low-alpha white stroke (`--stroke-x40 #ffffff29`),
  card padding roughly 16–20px **[CONFIRMED tokens, INFERRED exact px from visual
  proportion]**.

A single-outcome/scalar market card (temperature) looks the same at the header level but
replaces the two-row outcome list with **one big number + label** ("78.2° forecast") and a
full-width sparkline chart in the single brand-mint color — see App Store shot 4.

---

## 3. Market detail page

**[OBSERVED directly, App Store shots 2, 4, 5 — three different market types]**

### 3.1 Header
Back arrow (left) · `···` more · share/upload icon · comment-count bubble (speech-bubble
icon + count, e.g. "1.1k", tinted mint-green when there's unread/live activity) — top row.
Below: category icon + a small metadata label (a year, "2028", for elections; or category
name, "DAILY TEMPERATURE" / "PRO BASKETBALL (M)", for others), then the market question as
a large bold white headline (can wrap two lines), then either:
- a **live "Chat" pill button** top-right of the headline row (rounded pill, dark fill,
  small chat-bubble icon, "Chat" label) for single-outcome markets, or
- a **stats-row** for live sports: red "LIVE" pill + elapsed/period clock text
  ("OVERTIME 00:29:41"), then a big score line with team shoe/logo icons and score
  ("104 – 115"), then a "Last Play" ticker line, then a small tab bar ("Stats" / "Live
  chat").

### 3.2 Price history chart
Multi-series line chart directly under the header, on the page's own dark background (not
a separately-elevated card in the observed crops) — confirms **[OBSERVED]**:
- For a multi-outcome market (2028 election): a small legend above the chart, one row per
  outcome — colored dot + name + current percentage ("● Marco Rubio 19%", "● J.D. Vance
  17%", "● Gavin Newsom 14%"), colors are the same brand accent ramp used elsewhere
  (green `#28c995`-family, blue `#3f8efa`-family, orange `#fb9706`-family — closely
  matching the confirmed CSS `--green-x10 #39bf5b` / `--blue-x10 #36b0d9` /
  `--orange-x10` tokens once you account for chart-line anti-aliasing/JPEG softening in
  the sampled screenshot).
- Faint gray "Kalshi" wordmark watermark sits inside the chart area, upper-right.
- No visible gridlines or axis labels in the mobile crop (chart bleeds edge-to-edge); a
  y-axis (0–100%) and x-axis month ticks per the brief are plausible for the wider desktop
  layout but **not directly confirmed** this pass — flag as **[INFERRED]**.
- Below the chart: total volume, left-aligned, muted gray, dollar-formatted ("$38,479,140
  vol" / "$288,997 vol" / "$69,314,594 vol"); and a **time-range tab group**, right-
  aligned: `1D · 1W · 1M · ALL` for resolved-ahead markets, or `LIVE · 1D · 1W · 1M · ALL`
  for in-progress games — active tab bold/white, inactive tabs dimmed gray.
- Live sports chart is dual-line, one line per team in that team's assigned accent color
  (observed: magenta/pink `#880235`-ish for one team, blue `#0067b8`-ish for the other —
  team colors appear to be *per-market dynamic*, not fixed brand tokens), with a small
  live percentage tag pinned to the end of each line ("NYK 99%" / "CLE 1%").

### 3.3 Order ticket / Yes-No entry
- Single-outcome markets surface a **"Chat" pill**, not an inline order ticket, in the
  header of the mobile crop — the buy/sell ticket itself is presumably a bottom-sheet or
  the desktop right-rail drawer (`--trader-drawer-width` token, §1.4), not visible in these
  five crops. **[INFERRED]**.
- Live two-outcome sports markets instead show **two full-width pill buttons pinned to the
  bottom of the screen**, one per team, solid-filled in that team's accent color with the
  team abbreviation as the label (pink "CLE" / blue "NYK") — this is the closest direct
  observation of a "buy" affordance: tapping a colored full-width pill is the primary Yes/
  No (here: "buy this team") action, not a two-step ticket.
- A **"Markets" table** appears under the chart on every multi-row market (election
  candidates, temperature brackets): row = avatar/range label (left) + two independent
  outlined percentage pills (right) under column headers **Yes** / **No** — e.g. "Marco
  Rubio · 19% · 81%", "76° to 77° · 24% · 76%". Each row's own name/range is underlined in
  that row's assigned accent color, matching the chart legend.
- Order types: **[CONFIRMED via API/help docs]** Limit order (set your own price; unfilled
  remainder rests in the book) and Market/"Quick" order (immediate fill at best available
  price across levels, i.e. walks the book, slippage risk scales with size vs. depth).
  API-level (not necessarily surfaced in the consumer UI) also supports IOC
  (immediate-or-cancel, partial fill allowed, remainder auto-cancelled), FOK
  (fill-or-kill, all-or-nothing), and GTC with an optional Unix-timestamp
  `expiration_time`.

### 3.4 Orderbook / depth
**[CONFIRMED via help center]** Toggleable between **bid view** and **ask view**; shows
resting-order quantity at each price level for both Yes and No sides. Because Yes/No are
complementary (§5), the book is really one two-sided book expressed twice. Not visually
observed this pass (no crop showed the raw depth ladder) — layout is **[INFERRED]** to be
a standard two-column price/size ladder, likely inside the same right-rail drawer as the
order ticket.

### 3.5 Position / portfolio view
**[OBSERVED, App Store shot 3]** — a post-settlement "receipt" style card: "Position
closed" header, then a dark card with a maroon/deep-red gradient background (loss-tinted;
inferred the same card uses a green gradient for a net-positive close, not directly seen)
containing: category icon + category label (top-left, "PRO FOOTBALL"), mint-green "Kalshi"
wordmark (top-right), event title, the specific position taken with implied probability at
entry ("Kansas City · Yes @ 52% chance"), a repeating ticket/barcode-style watermark strip
("Kalshi CA3C27A5341" tiled), then two stat columns — **INITIAL COST** (white) and **PAID
OUT** (green when positive) — and a timestamp + "CLOSED POSITION" caption in small
tracked-out caps. Below the card: "Share with friends" + Messages / Stories / More share
icons — confirms positions are designed as shareable social receipts, not just ledger
rows.

### 3.6 Rules & resolution source
**[CONFIRMED via help center, not visually observed]** Every market has a written "Rules
Summary": the exact value being measured, the market's timeline, and a **named resolution
source** (e.g. a specific government data release, a specific broadcaster). Kalshi's
market-operations team applies the stated rule against that source once it publishes and
posts settlement; ambiguous/delayed-source edge cases go through a documented dispute
process with the CFTC as ultimate regulatory backstop. Markets are not user-created
self-serve — Kalshi's own markets team reviews proposed rules/settlement sources against a
compliance and settlement-clarity bar before a market goes live (per this repo's own prior
research in `social-and-invites.md`, citing Kalshi's help center).

### 3.7 Comments / activity
**[OBSERVED]** A comment-bubble icon + live count sits in the top header of every market
page ("1.1k", "90", "169k") — tapping it presumably opens a comment/activity thread, not
captured in these crops, but its permanent placement in the primary header (not buried in
a tab) signals comments are a first-class, always-visible affordance, not an optional tab.

---

## 4. Mechanics

- **Binary event contracts**: each contract settles at exactly **$1.00** if the specified
  outcome occurs, or **$0.00** if it doesn't. **[CONFIRMED, help center]**: "Each contract
  is worth $1 if you are right."
- **Price = implied probability**: contracts trade in cents, 1¢–99¢; a contract's price is
  read directly as the market's aggregate probability estimate (a 24¢ contract ≈ 24%
  implied chance). **[CONFIRMED, help center]**.
- **CLOB matching**: standard price/size limit order book, not an AMM — resting limit
  orders provide liquidity ("maker"), incoming orders that cross the book take it
  ("taker"). **[CONFIRMED via API docs / help center]**.
- **Yes/No complementary pricing**: for a well-formed two-sided market, Yes-bid + No-ask ≈
  100¢ (and vice versa) minus the bid/ask spread — because buying No is mechanically the
  same exposure as selling Yes, the book is quoted so the two sides straddle $1.00. This
  means there is **no risk-free single-market arbitrage** on Kalshi; the only structural
  arbitrage is across a mutually-exclusive multi-outcome event where the summed Yes-asks
  fall under 100¢ (long the whole field) or summed Yes-bids exceed 100¢ (short the whole
  field), and in practice such gaps are thin, longshot, and rarely worth net of fees.
  **[CONFIRMED via help center + third-party analysis, cross-checked]**.
- **Fee formula** — **[CONFIRMED]**, cross-verified against this repo's own
  `pricing-mechanisms.md` §7.1 (which cites Kalshi's published fee-schedule PDF) and
  independently against three third-party breakdowns:
  ```
  taker_fee = round_up( 0.07 × C × P × (1 − P) )   // rounds UP to the nearest $0.0001 ("centicent")
  maker_fee = 0.0175 × C × P × (1 − P)              // exactly 1/4 the taker rate
  ```
  where `C` = number of contracts, `P` = contract price expressed as a probability in
  `[0,1]` (e.g. `0.50` for a 50¢ contract). The `P×(1−P)` term is the variance of a
  Bernoulli outcome: it peaks at `P = 0.50` (fee = **1.75¢/contract**, the maximum any
  single-contract taker fee can be) and shrinks toward 0 as price approaches either
  extreme (e.g. `P = 0.02` → fee ≈ 0.14¢/contract) — so fees scale with how much genuine
  uncertainty is being traded, not with notional size alone. Fees are charged **at trade
  execution**, on both entry and exit (a full round-trip pays the fee twice).
- **Settlement**: on resolution the position auto-settles to $1.00 or $0.00 with no trader
  action required; cash credits the trading balance within minutes of the market being
  declared resolved, though the operational lag before that declaration (waiting on an
  official data release, etc.) can be up to a few hours. **[CONFIRMED via help center]**.
- **Market makers**: Kalshi runs a **Liquidity Incentive Program** rewarding accounts that
  place resting (maker) orders that improve a market's quoted spread/depth — in addition
  to the structurally lower 0.0175 maker fee rate itself. **[CONFIRMED via help center
  article title/summary]**; program mechanics/eligibility not detailed this pass.
- **Multi-outcome markets** are implemented as a *set of mutually-exclusive binary
  markets* sharing one parent event — e.g. "Who will the next Pope be?" is one event
  containing N independent Yes/No markets, one per candidate, each with its own price,
  book, and settlement, with the constraint that exactly one resolves Yes. The public API
  reflects this directly: an event with `mutually_exclusive=true` returns one parent row
  by default (with an `outcomes[]` array and parallel `outcome_token_ids`), expandable to
  N per-outcome rows via `?expand=outcomes`. **[CONFIRMED via API/aggregator
  documentation]**.
- **Combos**: Kalshi also supports parlay-style "Combo" positions across legs — payout is
  the *product* of each leg's settlement value (e.g. two legs at $1.00 and one at $0.70
  pays $0.70 total, not $1.00), reflected in the UI as a "COMBO" pill/filter on the
  homepage. **[CONFIRMED via help center]**.

---

## 5. Visual design language

### 5.1 Color — **[CONFIRMED, live CSS custom properties]**

Kalshi ships everything as CSS variables in three suffixed tiers per hue — `x10` (solid),
`x20` (≈16% alpha fill), `x30` (≈32% alpha stroke), plus lighter `x40`/`x50` tint steps —
so every accent has a consistent solid/fill/border/tint quad. This is the mechanism behind
the outlined percentage pill (transparent fill, `x30`-alpha colored border, `x10` solid
colored text).

**Surfaces (dark theme):**
| Token | Hex | Role |
|---|---|---|
| `--surface-x10` | `#0a0c0f` | page background — near-black, cool-toned |
| `--surface-x20` | `#13161a` | card / elevated surface |
| `--surface-x30` | `#1b2029` | raised / hover state |
| `--surface-x40` | `#333333` | highest elevation |
| `--surface-overlay` | `#00000080` | modal scrim |
| `--special-tradeslip-bg` | `#000000bf` | order-ticket panel backing |

**Brand:**
| Token | Hex | Role |
|---|---|---|
| `--brand-primary` | `#28cc95` | Kalshi mint — wordmark, primary CTA, active nav. Independently confirmed by direct pixel-sampling the "Kalshi" wordmark in an App Store screenshot: sampled `#28cd93`/`#32c493` — matches to within JPEG noise. |
| `--brand-secondary` | `#00412b` | deep green, brand fill background |

**Semantic (note: these are distinct hues from `--brand-primary`, not the same green):**
| Token | Hex | Role |
|---|---|---|
| `--green-x10` | `#39bf5b` | Yes / up |
| `--green-x20` | `#39bf5b29` | Yes tinted background |
| `--green-x30` | `#39bf5b52` | Yes pill border |
| `--red-x10` | `#ff409f` | **No / down — this is a hot magenta-pink, not a true red.** Confirmed both in CSS and visually (the "No"/losing percentage pill and the "LIVE" badge read as pink, not crimson, in every screenshot). |
| `--red-x20` | `#ff409f29` | No tinted background |
| `--blue-x10` | `#36b0d9` | tertiary chart series |
| `--orange-x10` | `#ff9500`-family | quaternary chart series |
| `--purple-x10` | `#b266ff` | further series / Perps-adjacent accent |
| `--perps-purple-x10` | `#ae88ff` | Perps product accent (distinct from prediction-market purple) |
| `--teal-x10` | `#006d82` (dark-mode value) | additional series |
| `--yellow-x10` | warning/alert (dark-mode value `#664e00` base, alpha tokens off `#ffe14d`) |
| `--special-gold` / `--special-silver` / `--special-bronze` | `#e5bd45` / `#98a7b2` / `#b28474` | leaderboard ranks 1/2/3 |

**Text / stroke (alpha-on-white ramps, not solid grays):**
`--text-x10 #ffffffe6` (~90% white, primary) · `--text-x20 #ffffff99` (~60%, secondary) ·
`--text-x30 #ffffff73` (~45%, tertiary/muted) · `--stroke-x20 #ffffff57` ·
`--stroke-x30 #ffffff3d` · `--stroke-x40 #ffffff29` (hairline card borders). Using
alpha-over-background rather than fixed hex grays is why text/border contrast holds up
consistently as the same element moves across `x10`→`x20`→`x30` surface elevations.

**Chart line colors, sampled directly from a real multi-series chart screenshot** (2028
election odds line chart): green trace ≈ `#28c995`, blue trace ≈ `#3f8efa`, orange trace ≈
`#fb9706` — consistent with the `--green-x10`/`--blue-x10`/`--orange-x10` tokens above once
JPEG/anti-aliasing softening is accounted for.

Per-market **team/entity colors** (e.g. a live NBA game coloring each team's line and its
full-width order button) are **dynamic, assigned per market**, not fixed brand tokens —
sampled roughly `#880235`-ish magenta for one team, `#0067b8`-ish blue for the other, in a
single screenshot; treat these as illustrative, not canonical.

### 5.2 Typography — **[CONFIRMED font-face names from shipped CSS; family
identification/substitution is INFERRED]**

Kalshi's stylesheet loads custom-named font faces (with `Fallback` metric-matched
fallbacks for each): `kalshiSans` (body/default, `body { font-family: kalshiSans,
"kalshiSans Fallback", sans-serif }`), `kalshiSansRegular`, `kalshiSansMedium`,
`kalshiCondensed`, `kalshiCondensedMedium`, plus what read as licensed families rebadged
under custom `font-family` names: `graphikWideSuper`, `graphikWideSemibold`,
`graphikCompact`, `graphikCompactMedium` (the "graphik" naming strongly suggests these
are Commercial Type's **Graphik** family, specifically its Wide and Compact widths), and
`ooTheranLight` (naming suggests a licensed display face, exact foundry not identified).

Cross-checking against the App Store marketing screenshots: large headline copy ("A
federally regulated exchange.", "Understand what's next.", "Turn your view into a
position.") is set in a **tall, condensed, heavy-weight grotesk** — visually consistent
with `kalshiCondensed`/a Graphik Wide-or-Compact bold cut. In-app UI text (labels,
percentages, card titles, numerals) reads as a clean, humanist/grotesk sans at regular
weights, consistent with `kalshiSans`. Numerals in scorelines ("104 – 115") appear
tabular/monospaced-figure.

**Recommended substitution stack for a replica** (since the true `kalshiSans`/`kalshiCondensed`
files aren't retrievable): body/UI — **Inter** or **Geist** (both metrics-compatible
humanist grotesks with a similar x-height); display/headline — a condensed grotesk such as
**Archivo Condensed**, **Barlow Condensed Bold**, or **Founders Grotesk Condensed** for
the tall marketing headlines.

### 5.3 Shape, elevation, spacing
- Card radius: **[INFERRED from visual proportion, not measured]** roughly 12–16px on
  market cards, fully pill-rounded (`999px`) on percentage chips and the COMBO/Chat
  buttons — matches this repo's own synthesis note in `design-tokens-extracted.md`
  (radius 12px cards / 999px pills was the adopted recommendation for the Bet app itself,
  derived from this same token set).
- Card shadow: **[CONFIRMED]** `box-shadow: 0 0 12px #ffffff24, 0 12px 24px #0006` — a
  soft white glow plus a black drop shadow, i.e. elevated cards get a faint outward "halo"
  rather than only a downward shadow, which reads correctly on a near-black background.
- Percentage-pill border: thin, ~1.5–2px, fully saturated accent color (`x10` token) with
  transparent/near-transparent fill, bold colored text inside — no solid pill fills
  observed anywhere for percentages.
- Layout: `--content-width: 1320px` max content width **[CONFIRMED]**; two-row sticky
  header totaling `107px` **[CONFIRMED]**; right-rail drawer `360px` (`300px` at large
  breakpoint) **[CONFIRMED]**, shared between homepage promo rail and market-page order
  ticket.
- Hover states: **[NOT directly observed this pass]** — the `--surface-x30 #1b2029` token
  (named "raised/hover") strongly implies cards/rows lighten one elevation step on hover,
  consistent with the surface-ramp pattern used everywhere else.
- Dividers: thin hairlines using the low-alpha `--stroke-x40 #ffffff29` token rather than a
  flat gray — consistent with the rest of the alpha-based system.

---

## 6. Copy / tone

- **Positioning line** (App Store subtitle): *"Trade football, tennis, crypto"* —
  concrete, category-first, not abstract.
- **Core value prop lines** (App Store description): *"Trade real outcomes in a federally
  regulated prediction market."* / *"It's like trading stocks — but instead, you trade on
  events you understand."* / *"Predict whether an event will happen or not, and earn money
  if you're right."*
- **Regulatory-trust framing is a recurring headline**, not a footnote: marketing
  screenshot copy reads *"A federally regulated exchange."*, and the app description
  states *"the largest legal and federally regulated prediction market app in the U.S."*
  and *"Federally regulated as a Designated Contract Market (DCM) by the Commodity Futures
  Trading Commission (CFTC)."* — this is load-bearing brand copy, not small print.
- **Social proof**: *"Join 10M+ users trading thousands of prediction markets across
  finance, weather, culture, sports, and more."*
- **Feature-benefit headline pattern** (each paired with a short mint-green subhead, seen
  across all five App Store marketing frames): short, punchy, present-tense, period-
  terminated sentence fragments —
  - *"Understand what's next."* → *"See how the world is pricing events."*
  - *"Take a position on any outcome."* → *"Trade real world events, one forecast at a
    time."*
  - *"Markets update in real time."* → *"Prices move as events unfold."*
  - *"Turn your view into a position."* → *"Profit when you're right."*
- **In-app microcopy tone**: terse, numeric-forward, no filler — "Happening now",
  "Markets", "Last Play", "Position closed", "Initial cost", "Paid out", "Closed
  position", "Share with friends". Category labels and status tags are consistently
  ALL-CAPS ("TENNIS", "LIVE", "PRO FOOTBALL", "DAILY TEMPERATURE"), while questions/titles
  and body copy are sentence case.
- **Promo/incentive copy**: onboarding promo banner observed reads *"New Users: Get $10
  with promo code 'STORE'"* — direct, transactional, code-forward.
- **Empty states**: **[NOT OBSERVED this pass]** — no empty-state screen appears in any of
  the five App Store crops or help-center pages fetched; flag as unconfirmed.

---

## 7. Sources

- Kalshi help center: [What are prediction markets?](https://help.kalshi.com/en/articles/13823766-what-are-prediction-markets), [Limit Orders](https://help.kalshi.com/en/articles/13823811-limit-orders), [The Orderbook](https://help.kalshi.com/en/articles/13823828-the-orderbook), [Market Rules](https://help.kalshi.com/en/articles/13823822-market-rules), [Combos](https://help.kalshi.com/en/articles/13823820-combos), [Liquidity Incentive Program](https://help.kalshi.com/en/articles/13823851-liquidity-incentive-program), [Suggesting a new market](https://help.kalshi.com/en/articles/13823833-suggesting-a-new-market)
- Kalshi fee schedule PDF: https://kalshi.com/docs/kalshi-fee-schedule.pdf (referenced by help center; formula cross-verified against this repo's `pricing-mechanisms.md` §7.1)
- Kalshi API docs: https://docs.kalshi.com (Predictions API + Perps API; order types IOC/FOK/GTC, `mutually_exclusive`/`expand=outcomes` event semantics)
- Kalshi Pro: https://kalshi.com/pro ; Kalshi Perps: https://kalshi.com/perpetuals
- Apple App Store listing "Kalshi: Trade News & Sports" (https://apps.apple.com/us/app/kalshi-sports-culture-more/id1632713844) — description copy + five official marketing screenshots fetched directly from Apple's `mzstatic.com` CDN and visually/pixel-inspected (real in-app UI, not concept art)
- This repo's own prior research: `bet/research/design-tokens-extracted.md` and `bet/research/screenshots/kalshi-tokens.json` (live CSS custom properties pulled from kalshi.com via Playwright, 2026-08-09), `bet/research/pricing-mechanisms.md` §7 (fee formula), `bet/research/social-and-invites.md` (market review/creation process)
- Third-party analysis, cross-checked against official sources rather than trusted alone: Whirligigbear Substack ["Maker/Taker Math on Kalshi"](https://whirligigbear.substack.com/p/makertaker-math-on-kalshi), MarketMath.io [Kalshi fees](https://marketmath.io/platforms/kalshi), KalshiView.com [order types](https://kalshiview.com/blog/kalshi-order-types-explained-limit-market-ioc/) / [order book](https://kalshiview.com/blog/how-to-read-kalshi-order-book-visual-guide/), OddsAssist [bid/ask explainer](https://oddsassist.com/prediction-markets/bids-and-asks/), Wikipedia [Kalshi](https://en.wikipedia.org/wiki/Kalshi)
- Not accessible this pass: live kalshi.com (Vercel bot-detection checkpoint blocked curl/WebFetch/headless-screenshot services), `kalshi.com/brandkit` (429), `kalshi-fee-schedule.pdf` direct fetch (429), Kalshi's own X/Twitter design commentary (paywalled fetch)
