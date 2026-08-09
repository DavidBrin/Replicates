# Polymarket — Specification-Grade Research Writeup

Research date: 2026-08-09. Sources: live `polymarket.com` HTML/CSS (Next.js SSR payload, `_next/static` CSS chunks pulled directly and grepped for design tokens), `gamma-api.polymarket.com` and `clob.polymarket.com` public REST responses (fetched live), `docs.polymarket.com`, `help.polymarket.com`, and press coverage. Every claim below is tagged **[confirmed]** (pulled directly from live markup/CSS/API response), **[reported]** (from docs/press/help-center text, not independently re-verified against the app), or **[inferred]** (reasoned from adjacent evidence, not directly observed). Where a concrete hex/px value is given without a tag, it was extracted directly from Polymarket's shipped CSS custom properties.

---

## 0. How this doc was built (for reproducibility)

- Homepage HTML was fetched with a desktop UA; the page is Next.js SSR — real market data and full nav copy are present in the initial HTML, not just client-hydrated. **[confirmed]**
- Global stylesheet: `https://polymarket.com/_next/static/immutable/chunks/2mdzevhtyoqyb.css` (≈547KB, Tailwind-v4-style with `@layer theme` and many `--color-*` custom properties, light tokens under `:root`, dark overrides under `html[data-theme=dark]`). All hex values quoted below came from this file. **[confirmed]**
- Data APIs queried directly:
  - `GET https://gamma-api.polymarket.com/events?...`
  - `GET https://gamma-api.polymarket.com/markets?...`
  - `GET https://gamma-api.polymarket.com/tags?...`
  - `GET https://clob.polymarket.com/book?token_id=...`
  - `GET https://clob.polymarket.com/price?token_id=...&side=buy`
  - `GET https://clob.polymarket.com/midpoint?token_id=...`
  - `GET https://clob.polymarket.com/prices-history?market=...&interval=1d&fidelity=60`
  All returned live, unauthenticated, real data. **[confirmed]**

---

## 1. Information Architecture

### 1.1 Top bar

Left to right, per the actual DOM (`aria-label="Primary navigation"` wraps the whole header; logo has `aria-label="Polymarket Logo"`) **[confirmed]**:

1. **Logo** — "Polymarket" wordmark/glyph, links home.
2. **Search bar** — centered/left-of-center, `<form>` containing:
   - Magnifying-glass SVG icon (18×18, `stroke-width:1.5`) positioned absolute-left inside the input.
   - `<input placeholder="Search polymarkets...">` **[confirmed exact string]**. (A secondary/mobile search surface uses `placeholder="Search"` **[confirmed]**.)
   - `<kbd>/</kbd>` rendered absolute-right inside the input, `hidden` below `lg` breakpoint, styled `text-text-tertiary`, unbordered plain glyph (no visible key-cap chrome in the CSS captured) — i.e. typing `/` anywhere on the page is the documented shortcut hint. **[confirmed]**
3. **Nav text links**: "How it works", "Log in", "Sign up" — all present as literal strings in SSR HTML. **[confirmed]**
4. **Icon buttons**: bell/notifications with `aria-label="Notifications (F8)"` (F8 keyboard shortcut) **[confirmed]**, and a "More menu" (`aria-label="Open more navigation links"`, hamburger-style overflow) **[confirmed]**.
5. Watchlist/favorite toggle: `aria-label="Toggle watchlist"` and, on cards/detail pages, `aria-label="Add to favorites"` driving a `bookmarkButton` div (bookmark/star icon). **[confirmed]**

Additional confirmed micro-copy found in the header/footer region of the SSR payload: `aria-label="Toggle filters"`, `aria-label="Market tabs"`, `aria-label="Scroll right"` (nav row horizontal-scroll affordance), `aria-label="Featured markets carousel"`.

### 1.2 Primary nav row (category tabs)

Exact literal strings present in the homepage SSR HTML, matching the requested list almost verbatim **[confirmed]**:

`Trending · Combos · Perps · Breaking · New | Politics · Sports · Crypto · Esports · Iran · Finance · Geopolitics · Tech · Culture · Economy · Weather · Mentions`

Notes:
- "Trending / Breaking / New" behave as sort modes over the same market universe (recent-activity vs. new-listing vs. algorithmic trending); "Combos" and "Perps" are distinct **products**, not filters (see §4.6, §4.7), and are visually set apart from the topic tabs — "Combos" also carries its own `aria-label="Combos"`. **[confirmed presence, product-vs-filter distinction inferred]**
- The topic tabs correspond 1:1 to Gamma API `tags` (see §7.1) — `Iran` in particular exists as a first-class top-level tab despite being a country/event rather than an evergreen topic, reflecting Polymarket's practice of promoting a hot breaking-news topic to nav-row status. **[confirmed via /tags and nav text]**
- A horizontally-scrollable row (`aria-label="Scroll right"` chevron control) implies the tab row overflows on smaller viewports rather than wrapping. **[confirmed]**
- Secondary controls seen alongside/below the primary row: `24hr Volume` toggle, `All`, `Active` (market-status filter), and per-topic hide-toggles `Hide sports`, `Hide crypto`, `Hide earnings`. **[confirmed strings]**

### 1.3 Secondary chip row

Below the primary nav, a row of dynamic, topic-scoped filter chips. Confirmed literal chip strings captured from the live homepage **[confirmed]**: `All`, `Trump`, `Iran`, `August 11 Primaries`, `August 18 Primaries`, plus dated event chips like `August 9`, `August 14`, `August 15`, `August 16`, `August 17`, `August 26`, `August 31`. These chips are **event/tag driven and rotate daily** — they surface whatever is currently newsworthy (a named person, a country in the news, a dated primary/election) rather than being a fixed taxonomy. Build this as a data-driven horizontal chip list sourced from trending tags, not a hardcoded list. **[confirmed pattern, "rotates daily" inferred from date-specific chip names]**

### 1.4 Market card grid

- Responsive grid, Tailwind-style breakpoint classes found directly in the CSS/HTML: **[confirmed]**
  - base: `grid-cols-1`
  - `md:` `grid-cols-2`
  - `lg:` `grid-cols-3`
  - `xl:` `grid-cols-4`
- So "4 columns" is the desktop/xl state specifically; tablet is 3, small-tablet is 2, mobile is 1 — build it as a fluid grid, not a fixed 4-col.
- A "Featured markets carousel" (`aria-label`) sits above/interleaved with the grid — a horizontally-scrolling hero row distinct from the standard grid. **[confirmed]**
- Grid sections are headed by category/topic labels; a "Show more markets" / "View more" affordance paginates or expands the grid (both strings found in SSR HTML). **[confirmed]**

---

## 2. Market Card Anatomy

Polymarket does not use one card component — it branches on market shape (binary vs. multi-outcome vs. sports vs. live-price). All four variants below were corroborated either directly in markup or via the Gamma API's `markets[]` shape, which encodes exactly which variant a market needs (single outcome pair vs. many `groupItemTitle` rows vs. team/score fields).

### 2.1 Multi-outcome card ("Outcome — 86% — [Yes][No]" rows)

Used whenever an **event** has more than 2 outcomes (a Gamma `event` object with multiple `markets[]`, e.g. "Fed Decision in September?" had 4 sub-markets: `25 bps decrease`, `No change`, `25 bps increase`, `50+ bps increase`). **[confirmed via /events response]**

Card structure (top to bottom):
1. Event icon/image (from `event.icon`/`event.image`, an S3-hosted PNG) + title text.
2. A stacked list of outcome rows, each row = `groupItemTitle` (e.g. "25 bps decrease") + live probability percentage (derived from `outcomePrices`, price 0–1 shown as %) + a **Yes** button and a **No** button pair, right-aligned.
3. Typically only the top 3–4 rows show before a "+N more" collapse (inferred from `showAllOutcomes` boolean present on events **[confirmed field exists]**; exact collapse UX **[inferred]**).
4. Footer row (shared across all card variants, §2.5).

Each `market` sub-object inside an `event.markets[]` array carries its own `outcomes` (JSON-stringified array, typically `["Yes","No"]`), `outcomePrices` (JSON-stringified array of decimal strings summing to 1, e.g. `["0", "1"]` for a fully resolved market), `groupItemTitle` (the row label shown on the card), `clobTokenIds` (the two ERC-1155 token IDs backing Yes/No), and `bestBid`/`bestAsk`-style pricing implied by the CLOB. **[confirmed field names from live API]**

### 2.2 Single-binary card with circular gauge ("21% chance")

For a plain Yes/No market, the card instead shows one big probability with a circular/ring gauge rather than a row list.

- Confirmed exact markup pattern captured from a live page: 
  ```html
  <p class="text-heading-2xl text-[28px] font-semibold text-text-brand">21%<!-- --> <!-- -->chance</p>
  ```
  i.e. the literal text is **"21% chance"** (percentage + space + lowercase "chance"), styled with the `text-brand` color token (blue, see §5) at 28px/semibold. **[confirmed]** — this exact node was observed on a market-detail hero; card-grid usage of the same "N% chance" phrase + a smaller ring is the standard compact variant **[inferred layout, confirmed copy string]**.
- The ring itself: an SVG circular progress indicator (percentage-of-circumference stroke-dasharray) is the standard way this pattern is built; Polymarket's own icon set includes circular/donut SVGs (`viewBox="0 0 18 18"` icons observed elsewhere in the CSS/markup), consistent with a small ring gauge sized to sit beside or behind the percentage text. **[inferred implementation, confirmed that a numeric-percentage + "chance" label pairing is the real copy pattern]**
- Below/beside the number: a single **Yes** / **No** button pair (green/red, tinted backgrounds — see §5.3).

### 2.3 Sports card (two teams, scores, two colored buttons)

Confirmed directly from live Gamma API sports events (e.g. "National Bank Open: Joao Fonseca vs Ben Shelton", "Cleveland Guardians vs. Chicago White Sox"):

- Event-level fields: `score` (e.g. `"2-3"`, `"2-5"`), `period` (e.g. `"S1"`, `"Mid 8th"`), `live` (boolean), `gameId`, `gameStartTime`, `eventDate`. **[confirmed field names + values from live API]**
- CSS grid template names literally found in the shipped stylesheet **[confirmed]**:
  ```
  grid-template-areas: 'team-0-logo team-0-name' 'team-1-logo team-1-name'
  grid-template-areas: 'team-0-score team-0-logo team-0-name' 'team-1-score team-1-logo team-1-name'
  ```
  — i.e. Polymarket's own CSS names the exact layout as two stacked rows, each `[score] [logo] [team name]`, confirming "two team logos, scores" is a literal named grid, not a guess.
- Sports markets also carry moneyline/spread/total sub-markets in the same event, with literal UI copy found: `Spread`, `Total`, e.g. `"O 2.5"` / `"U 2.5"` (over/under) and `"QUE +1.5"` / `"SEA -1.5"` (spread with team abbreviation + line). **[confirmed strings]**
- Two colored team buttons at the bottom = the Yes/No buttons re-skinned per team (moneyline pick), using the same green/red (or a neutral gray/blue pair) trading-button component described in §5.3 — Polymarket's CSS literally defines a `.trading-button[data-color=...]` component with `blue`, `green`, `red`, `gray`, `light-blue` variants used across both prediction and sports contexts. **[confirmed component + variants, team-color mapping inferred]**

### 2.4 Live/price card ("BTC Up or Down 5m")

Confirmed via live Gamma events: `"Bitcoin Up or Down"`, `"BTC Up or Down 5m"` market titles exist, with literal outcome/button copy **"Up"** / **"Down"**. **[confirmed]**

- Floating delta amounts: the SSR homepage payload contains the literal strings **`↑ $80`** and **`↓ $75`** — up/down-arrow-prefixed dollar deltas, exactly matching the "floating +$ amounts" described in the prompt (these are ephemeral trade-ticker toasts that float up from the price line, not static card content). **[confirmed strings, exact placement/animation inferred]**
- These short-duration (e.g. 5-minute) crypto up/down markets recur on a rolling schedule (new "5m" market spun up continuously) — consistent with Polymarket's broader live/real-time crypto price market family separate from the perps product (§4.7). **[inferred cadence, confirmed market naming]**

### 2.5 Shared card footer row

Confirmed literal strings across the SSR payload: **`Vol`**, **`Vol.`**, dollar-formatted volume figures like `$9M`, `$21M`, `$1B`, `$4M`, `$54K` (i.e. the card footer shows `"$9M Vol."` style text using compact K/M/B suffixes). **[confirmed]**

- Live-status badge: `live` boolean on events/markets drives a **LIVE** badge (uppercase, likely red/accent-colored dot + text — exact color **[inferred]** from the `--market-negative`/red family or a dedicated live-indicator token not captured in this pass).
- Game-state badge text is **data-driven from `period`**, confirmed real values include `"Mid 8th"`, `"S1"`, `"FT"` (full time) — the UI presumably uppercases this via `text-transform` (matching the prompt's "GAME 2 / MID 8TH" pattern). **[confirmed field + sample values; uppercase CSS transform inferred]**
- Bookmark icon: `bookmarkButton` div behind an `aria-label="Add to favorites"` ghost icon-button (`rounded-full`, 36×36px — `h-9 w-9` Tailwind classes). **[confirmed]**
- Comment count: events carry a `commentCount` integer field in the Gamma API (seen values `0`, `1296`, `8636` on a Fed-decision market) — the card footer's comment-bubble icon + number is backed directly by this field. **[confirmed field]**
- Gift icon: not captured directly in this pass (not present on the specific homepage snapshot fetched) — likely a "tip/send this market" or referral affordance shown conditionally (e.g. on hover, or only for certain promo markets). **[inferred existence per prompt, unconfirmed placement/behavior]**

---

## 3. Market Detail Page

Captured from a live event page (`Fed Decision in September?`) plus the docs/help corpus.

### 3.1 Outcome list
Multi-outcome markets show each `groupItemTitle` with live % and Yes/No buttons, same row pattern as the card (§2.1), just full-width and with per-row volume shown (e.g. "$36M–$67M" range across outcomes on the Fed market). **[confirmed]**

### 3.2 Price chart
- A historical price series is served by `GET clob.polymarket.com/prices-history?market={tokenId}&interval=1d&fidelity=60`, returning `{"history":[{"t": <unix_seconds>, "p": <price 0..1>}, ...]}`. **[confirmed live response shape]**
- `interval` accepts at least `1d` (tested); the UI's timeframe toggle (**1H / 6H / 1D / 1W / 1M / ALL**, per the prompt) almost certainly maps to `interval`+`fidelity` pairs (fidelity = minutes-per-point, coarser for longer ranges) — exact accepted enum values for `interval` beyond `1d` were **not independently re-tested** in this pass. **[inferred mechanism, confirmed endpoint + one working interval]**
- A CSS custom property `--crosshair-line-color` (default `#aeb4bc66`, i.e. a translucent gray, with a `var(--market-negative)` variant) confirms a chart crosshair component exists with red/negative styling available for down-trending series. **[confirmed]**
- `--market-positive` resolves to green-600 (light) / green-500 (dark); `--market-negative` resolves to red-500 in both themes (see §5.2 for hex values) — i.e. the price line/positive-negative delta coloring reuses the same green/red tokens as the Yes/No buttons, not a separate chart palette. **[confirmed]**

### 3.3 Buy/Sell + Yes/No ticket
- Not directly captured in this pass's markup sample, but the `.trading-button` component (§5.3) with `data-color=green|red|blue|gray|light-blue` and `data-combo-state=addable|added|disabled` attributes is the shared primitive for every buy button across cards, detail page, and the Combos tray. **[confirmed component API surface, exact ticket layout inferred from standard CLOB-frontend conventions: amount input, Buy/Sell tab switch, Yes/No toggle, "To win $X" payout preview]**
- "To win $X" copy itself was not captured verbatim in this pass — treat as **[inferred]** phrasing pending direct confirmation (very likely correct based on prompt + universal prediction-market UX convention, but not observed).
- Order minimum size and tick size are enforced server-side and returned per-market: `orderPriceMinTickSize: 0.001`, `orderMinSize: 5` (i.e. prices move in $0.001 increments, minimum order is 5 shares) — confirmed on multiple live markets. **[confirmed]**

### 3.4 Order book
- `GET clob.polymarket.com/book?token_id={tokenId}` returns `{"market": "<conditionId>", "asset_id": "<tokenId>", "timestamp": "...", "hash": "...", "bids": [...], "asks": [{"price": "0.999", "size": "101179"}, ...]}`, each level a `{price, size}` string pair, sorted book depth. **[confirmed live response shape]**
- `GET clob.polymarket.com/price?token_id=...&side=buy` → `{"price": "0"}`; `GET clob.polymarket.com/midpoint?token_id=...` → `{"mid": "0.0005"}`. **[confirmed]**
- Both `bestBid`/`bestAsk`-style single numbers and full depth are available — the order-book UI (typically a two-column bid/ask ladder with cumulative-size bars) can be built directly off `/book`. **[confirmed data source; visual ladder rendering inferred]**

### 3.5 Holders / top holders, activity, comments
- `commentCount` is a first-class Gamma field (§2.5); a full comments/activity feed almost certainly hits a Data API/CLOB-adjacent endpoint not exercised in this pass. **[inferred existence, unconfirmed endpoint]**
- "Top holders" leaderboards are a well-documented Polymarket feature (per-market ranked holder list by position size) — not independently re-verified against a live endpoint in this pass. **[reported, not confirmed live]**

### 3.6 Rules / resolution criteria
- Every market carries a long-form `description` field from Gamma that **is** the literal rules text shown on the page (confirmed verbatim on both the LoL esports market and the Fed market — multi-paragraph resolution criteria, named resolution source URL, edge-case handling for cancellation/forfeiture/50-50 fallback). **[confirmed field is the actual rules copy, not a summary]**
- `resolutionSource` is a separate field (a canonical URL) shown alongside/within the rules block. **[confirmed]**
- `umaResolutionStatus` (`"resolved"`, `"proposed"`, etc.), `umaBond`, `umaReward`, `umaEndDate`, `customLiveness` (dispute-window override in seconds, e.g. `1800`) are all present per-market — these back a "resolution status" widget showing where in the UMA lifecycle (§4.4) the market currently sits. **[confirmed fields]**

### 3.7 Related markets
Confirmed present on the Fed-decision page: links to the next several recurring Fed-decision markets (Sep/Oct/Dec 2026, Jan 2027) — i.e. related markets are drawn from the same `series` (Gamma events carry a `series[]` array with `seriesType`, `recurrence: "daily"`/etc., `seriesSlug`) rather than generic topic similarity. **[confirmed via `series` field + observed related-links behavior]**

---

## 4. Mechanics

### 4.1 Outcome tokens
Each binary market resolves to exactly one of two ERC-1155 **conditional tokens** ("Yes"/"No", or named outcomes for multi-outcome events), which pay out **$1.00** if correct and **$0** if not, backed 1:1 by **USDC** collateral locked in Polymarket's conditional-tokens smart contracts (Gnosis Conditional Tokens Framework fork). **[reported — standard, well-documented Polymarket architecture; token IDs (`clobTokenIds`) and position IDs (`positionIds`) were directly confirmed as real per-market fields in the live API, e.g. two large uint256 strings per market]** **[confirmed field presence]**

### 4.2 CLOB architecture
Hybrid-decentralized central limit order book: an off-chain operator hosts the book and matches orders (sub-second, gas-free quoting/matching); **matched trades settle on-chain** via the conditional-tokens + exchange contracts on Polygon. Public read endpoints (`/book`, `/price`, `/midpoint`, `/prices-history`) require no auth; placing/cancelling orders requires EIP-712-signed requests plus L2 API-key headers (HMAC-style, derived from a wallet signature). **[reported, consistent with confirmed unauthenticated read access observed directly]**

### 4.3 Complementary pricing
Yes price + No price = $1.00 by construction (arbitrage-enforced) — directly visible in the live order-book sample pulled: a market at 0.9995 for one side had `midpoint = 0.0005` for the complementary token, and `outcomePrices` arrays across every market fetched summed to 1 (e.g. `["0.0005","0.9995"]`). **[confirmed via live data across multiple markets]**

### 4.4 Splitting / merging complete sets
Any USDC holder can mint one Yes + one No token (a "complete set") directly from the smart contract for $1, and conversely merge one Yes + one No back into $1 USDC — this is what lets market makers create/destroy inventory without trading, and is the standard mechanism referenced in Polymarket's own docs. **[reported, standard CTF mechanic, not independently re-tested against a live contract call in this pass]**

### 4.5 UMA optimistic-oracle resolution
- Flow: someone proposes an outcome to UMA's Optimistic Oracle and posts a bond (Polymarket markets observed with `umaBond: "250"`, some with `"750"` reported elsewhere for higher-stakes markets); a **dispute window** opens (commonly ~2 hours, but per-market configurable via `customLiveness`, e.g. `1800` seconds = 30 min observed on a live tennis market) during which anyone can dispute by posting a matching bond. **[confirmed field values from live API; "2 hours" default and dispute economics **[reported]**]**
- If undisputed, the market resolves to the proposed outcome and tokens become redeemable ~2 hours after proposal. **[reported]**
- If disputed, the question escalates through a commit-reveal UMA token-holder vote, stretching resolution to **4–6 days**, with the potential for a second dispute round. **[reported]**
- `umaResolutionStatus` field observed with real values `"resolved"` and `"proposed"` — i.e. this exact state machine is directly exposed per-market in the API, not just conceptual. **[confirmed field]**

### 4.6 Fees
Historically zero trading fees; as of a March 30, 2026 "Fee Structure V2," **taker fees** now apply, varying by category: crypto 7%(of spread, or bps-scaled), sports 3%, finance/politics/mentions/tech 4%, economics/culture/weather/other 5%, geopolitics/world-events markets remain fee-free. **Makers pay 0%** and receive rebates funded by taker fees (20% of collected taker fees on crypto markets, paid daily). Fee caps: $1.00/100 shares (politics/finance/tech/mentions), $1.25/100 shares (sports/economics/culture/weather/other), $1.75/100 shares (crypto). A separate US-exchange fee schedule (effective Apr 3, 2026) applies a flat 5% taker fee with a −1.25% maker rebate, capped at $1.25/100 contracts at 50¢. **[reported, from help-center/press coverage, not independently re-derived from a live trade]**
- Live per-market fee-related fields directly confirmed in Gamma API: `makerBaseFee`, `takerBaseFee` (e.g. both `1000` — presumably basis-points-scaled integers) present on every market object. **[confirmed field presence, unit/scale inferred]**

### 4.7 Liquidity rewards
Daily-paid rewards (in **PUSD**, Polymarket's own dollar-pegged reward currency) to makers whose resting limit orders sit close to the midpoint on both sides of the book; reward weight is a quadratic function of price-proximity to midpoint (posting near mid earns disproportionately more than posting wide), plus a size component; a day only pays out if earnings reach $1 (sub-$1 days are dropped, not rolled over). Separate "Sponsor Rewards" exist where market creators/sponsors can boost rewards on specific markets. **[reported]**
- A holding-rewards feature was also directly observed: `aria-label="Earn 3.25% holding rewards"` in the live homepage markup — i.e. simply holding a balance (likely USDC/PUSD deposited on-platform) earns a stated 3.25% yield, separate from LP/maker rewards. **[confirmed aria-label + rate, mechanism inferred]**

### 4.8 Combos
Launched ~June 10–11, 2026. Lets users bundle picks across multiple (currently sports-only) markets into a single Yes/No parlay-style trade — moneyline, spread, and totals legs combinable. Uses a **Request-for-Quote (RFQ)** flow: user requests a combo price, competing market makers have 400ms to submit quotes, user has 10s to accept the best one by signing. All legs must resolve in the user's favor for any payout (standard parlay "all or nothing" structure) — no partial credit for 4-of-5 correct. **[reported, from press coverage of the launch]**
- Confirmed directly in the live CSS/HTML: `.trading-button[data-combo-state=addable|added|disabled]` states and CSS vars like `--combo-tray-counter-translate`, `--combo-widget-max-height`, `--combo-tray-surface-height:302px` — i.e. Combos is built as a persistent bottom "tray" UI (like a shopping-cart drawer) that morphs/expands as legs are added, at a max height of `100dvh - navbar-height - 4rem`. **[confirmed real CSS implementation details]**

### 4.9 Perps
Announced April 21, 2026 (beating Kalshi's competing launch); beta went live May 28, 2026 to a restricted user list. Lets users go long/short with up to **20x leverage** via isolated-margin accounts on crypto (BTC, ETH, SOL, HYPE) and select macro/equity underlyings (S&P 500, NVDA, NFLX, HOOD). Positions don't expire (true perpetual, no contract-roll), with on-chain settlement. Reachable at `polymarket.com/perps` and `polymarket.com/perps/crypto`. **[reported, from press coverage]** Card-grid presence: "Perps" appears as its own top-level nav item, distinct from spot prediction markets. **[confirmed nav item]**

---

## 5. Visual Design Language

All values in this section are **[confirmed]** — extracted verbatim from Polymarket's shipped CSS custom properties (`2mdzevhtyoqyb.css`), captured for both the light (`:root`) and dark (`[data-theme=dark]`) themes. Polymarket ships a **full light/dark theme system** (`html[data-theme=dark]`), not a dark-only design — build the replica with both.

### 5.1 Typography
- **Font**: Inter, loaded as a self-hosted **variable font** (`InterVariable-s.p.woff2`, preloaded), with explicit OpenType feature settings: `font-feature-settings: "liga" 1, "calt" 1, "cv01" 1, "cv02" 1, "cv03" 1, "cv04" 1, "cv09" 0, "cv11" 1, "cv15" 1` (Inter's stylistic-set alternates for a, l, i-related glyphs — a deliberate "not-default-Inter" look).
  - Body font stack in practice: `font-family: var(--font-inter, "Inter"), sans-serif`.
  - A secondary stack `Suisse Intl, Inter, sans-serif` also appears (likely marketing/landing surfaces or a specific heading treatment) — Suisse Int'l as primary with Inter fallback.
  - Monospace: `Geist Mono, SF Mono, monospace` (used for numeric/price displays, order book, ticker-style content) — separate token `--font-mono: "Geist Mono", monospace`.
  - System-font fallback chain also present: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`.
- **Type scale** (named utility classes, exact px/weight/line-height/tracking):

  | Class | Size | Weight | Line-height | Letter-spacing |
  |---|---|---|---|---|
  | `.text-heading-4xl` | 40px | 600 | 44px | −0.025em |
  | `.text-heading-3xl` | 32px | 600 | 36px | −0.01em |
  | `.text-heading-2xl` | 24px | 600 | 28px | −0.015em |
  | `.text-heading-xl` | 20px | 600 | 24px | −0.01em |
  | `.text-heading-lg` | 16px | (inherit) | 20px | −0.18px |
  | `.text-heading-base` | 14px | (inherit) | 16px | −0.09px |
  | `.text-body-lg` | 16px | (inherit) | 24px | −0.18px |
  | `.text-body-base` | 14px | (inherit) | 20px | −0.09px |
  | `.text-body-sm` | 13px | 490 | 16px | −0.1px |
  | `.text-body-xs` | 12px | 500 | 16px | −0.1px |

  Note the **negative tracking at every size** and the unusual `font-weight: 490` (a fractional variable-font weight between Regular 400 and Medium 500) on `body-sm` — a deliberate variable-font-axis choice, not a rounding artifact.

### 5.2 Color tokens

**Brand / accent blue** (this is the primary accent, used for the CTA/"chance" text, links, primary buttons):
- `--blue-500: #1652F0` (light), same in dark — this is the core accent, matching the "1652F0 family" hypothesis in the brief almost exactly.
- Full blue ramp (light theme): 50 `#e8eefe` · 100 `#becffb` · 200 `#94aff8` · 300 `#6a90f5` · 400 `#4071f3` · 500 `#1652f0` · 600 `#0c3ec1` · 700 `#092d8d` · 800 `#061c58` · 900 `#020b23`.
- A second, distinct "brand" ramp also exists (used for a different sub-brand or the trading-button `blue` variant): `--brand-500: #1452f0` (light) / `#0093fd` (dark) — i.e. **brand blue shifts to a brighter cyan-blue in dark mode**, while the plain `blue-500` token stays fixed. Confirm which one backs the primary CTA before committing to a single hex — both are real, live tokens.

**Green (Yes) / Red (No)**:
- `--green-500: #42c772` (base token); trading-button green uses `--color-green-600: #30a159` (light) with `--color-green-400: #64d18b` (light-mode token, but note: **in dark theme, `.trading-button[data-color=green]` switches to `--color-green-400`, which itself re-resolves to `#359a5e` in dark** — i.e. Yes-button green is deliberately darker/more muted in dark mode, not brighter).
- `--red-500: #e23939` (light) / `#cb3131` (dark) — used directly for `.trading-button[data-color=red]` in both themes (red doesn't get the light/dark swap treatment green does).
- Chart semantics: `--market-positive: var(--green-600)` (light) → resolves dark-mode to `var(--green-500)`; `--market-negative: var(--red-500)` in both themes.
- Full green ramp: 50 `#ecf9f1` · 100 `#caefd8` · 200 `#a8e5be` · 300 `#86dba5` · 400 `#64d18b` · 500 `#42c772` · 600 `#30a159` · 700 `#237641` · 800 `#164b29` · 900 `#091f11`.
- Full red ramp: 50 `#fcebeb` · 100 `#f7c8c8` · 200 `#f2a4a4` · 300 `#ec8080` · 400 `#e75d5d` · 500 `#e23939` · 600 `#c61d1d` · 700 `#951616` · 800 `#640f0f` · 900 `#330707`.

**Trading-button component** (`.trading-button[data-color=...]`, the shared primitive behind every Yes/No/team/Buy button):
```css
.trading-button[data-color=green]{
  --btn-background:#30a159;      /* green-600 */
  --btn-background-hover:#30a159;
  --btn-shadow:0 calc(var(--btn-shadow-height)*-1) 0 0 #0003 inset;
  --btn-shadow-hover:0 calc(var(--btn-shadow-height)*-1) 0 0 #00000039 inset;
  --btn-color:#fff;
}
.trading-button[data-color=red]{
  --btn-background:#e23939;      /* red-500 */
  --btn-background-hover:#e23939;
  --btn-shadow: /* same inset-shadow pattern */;
  --btn-color:#fff;
}
.trading-button[data-color=blue]{ --btn-background:var(--brand-500); --btn-color:#fff; }
.trading-button[data-color=gray]{ --btn-background:var(--color-neutral-50); --btn-hover-opacity:.8; }
.trading-button[data-color=light-blue]{ --btn-background:#ecefff; /* dark: #1f3050 */ --btn-hover-opacity:.8/.9; }
```
Key implementation detail: buttons are **solid-fill white-text**, not the "low-opacity tinted background" pattern hypothesized in the brief — i.e. build Yes/No as filled saturated-color buttons with a subtle inset bottom shadow for depth (`0 -1px 0 0 rgba(0,0,0,0.2) inset`-style), not translucent tint chips. (Low-opacity tint chips may still exist elsewhere, e.g. for probability-percentage badges — not confirmed in this pass.) Hover state = **same background color** (no darken-on-hover for green/red — dark-mode green instead swaps to a different token entirely; `--btn-hover-opacity: .8` is used on the gray/light-blue variants instead of a background swap).

**Backgrounds / surfaces / text** (theme-paired, light → dark):
- App background (`--color-background` → `--neutral-0`): `#fff` → **`#15191d`** (this is Polymarket's real dark-mode canvas — a near-black with a faint blue-gray cast, close to but not identical to the brief's guessed `#0d1017`/`#111319`).
- `--neutral-25`: `#f9fafb` → `#181d21`
- `--neutral-50`: `#f4f5f6` → `#1e2428`
- `--neutral-100`: `#e6e8ea` → `#242b32` (card/surface-hover level)
- `--neutral-200`: `#caced3` → `#2e3841`
- `--neutral-900`: `#d2d8df` → `#1a1c1f`
- `--neutral-950` (primary text): `#0e0f11` → `#dee3e7` (near-black text on light, near-white on dark — standard semantic flip)
- `--border` token: `#e5e7eb` (light) → `#1f2937` (dark) — a cool dark slate-gray border, not pure gray.
- `--color-border` (Tailwind-theme alias): `var(--color-neutral-100)`.
- Text roles: `--color-text-primary: var(--neutral-950)`, `--color-text-secondary: var(--neutral-500)`, `--color-text-tertiary: var(--neutral-300)`, `--color-text-disabled: var(--neutral-300)`/`gray-500`, `--color-text-brand: var(--brand-500)`, `--color-text-inverse: var(--neutral-0)`.
- Alpha overlays (for scrims/hovers), theme-paired black→white opacity ramps: `--alpha-50` … `--alpha-900` from `#00000003` up to `#000000e0` (light, black-based) and `#ffffff05` up to `#ffffffeb` (dark, white-based) — used for hover/pressed states layered over any surface.

**Other named accents observed** (spot-usage, not full ramps): `--pusd-accent: #2e5cff` (PUSD reward-currency brand color), `--usdc-accent: #2775ca` (USDC's own brand blue, standard), `--shimmer-color: #f5d67a` (gold, likely a loading/skeleton shimmer or a rewards-highlight), `amber` ramp (500 `#f99c00`) for warning/pending states, `magenta` (500 `#f476c6`/600 `#ee2ba6`) and `purple` (500 `#bd8de7`/600 `#9445d9`) ramps present for category-tag coloring, `yellow` ramp (500 `#f8d743`).

**Election-specific "tier" colors** (found under `:root`, clearly for a midterms/election forecast module — safe/likely/lean/tossup by party): `--tier-safe-d:#0034eb`, `--tier-likely-d:#5c7fff`, `--tier-lean-d:#a8bbff`, `--tier-tossup:#9445d9`, `--tier-lean-r:#ffa8aa`, `--tier-likely-r:#f5474a`, `--tier-safe-r:#a80004` — a red/blue/purple political-map palette, separate from the trading green/red.

### 5.3 Radii, shadows, spacing
- Base spacing unit: `--spacing: .25rem` (4px) — a standard 4px grid (Tailwind default).
- Border-radius scale, all derived from one base `--radius: .7rem` (11.2px):
  - `--radius-xs: calc(var(--radius) - 6px)` ≈ 5.2px
  - `--radius-sm: calc(var(--radius) - 4px)` ≈ 7.2px
  - `--radius-md: calc(var(--radius) - 2px)` ≈ 9.2px
  - `--radius-lg: var(--radius)` = 11.2px (default card/button radius)
  - `--radius-xl: calc(var(--radius) + 4px)` ≈ 15.2px
  - `--radius-2xl: 1rem` = 16px
  - `--radius-3xl: 1.5rem` = 24px
  - `--radius-full` (pills/avatars/circular gauge ring): effectively `9999px`.
- A `corner-squircle` utility class (`corner-shape: squircle`) is used for select surfaces — Polymarket uses **true CSS squircle corners** (not just border-radius) on at least some components (likely avatar/icon containers), a modern-native-feeling detail worth replicating with the CSS `corner-shape` property or an SVG squircle mask/clip-path fallback.
- Button depth: `--btn-shadow: 0 calc(var(--btn-shadow-height) * -1) 0 0 #0003 inset` — i.e. buttons get a subtle **inset shadow along the bottom edge only** (not a full drop shadow), giving a slight "pressed-in" bevel at rest that intensifies on hover (`#00000039` alpha vs. `#0003`/`#00000030`).

### 5.4 Component notes
- **Circular gauge**: no dedicated `--gauge-*` tokens were found in this pass; the percentage display itself uses `.text-heading-2xl` (24–28px/600) colored with `--color-text-brand` (blue). Build the ring as an SVG circle with `stroke-dasharray`/`stroke-dashoffset` proportional to probability, radius track colored `--neutral-200`/`--neutral-100`, and progress arc colored `--blue-500` (or green/red if the design ties ring color to Yes/No lean — not confirmed either way). **[inferred implementation]**
- **Interactive states**: `active:scale-[97%]` is a real, directly-observed Tailwind arbitrary-value class on buttons — every clickable button in the app scales down to 97% on `:active` with a `transition duration-150` — a specific, replicable micro-interaction. `disabled:opacity-50 disabled:pointer-events-none` for disabled buttons. `focus-visible:ring-1 focus-visible:ring-ring` for keyboard focus rings.
- **Icon-button ghost style**: `bg-button-ghost-bg text-button-ghost-text hover:bg-button-ghost-bg-hover`, `h-9 w-9 rounded-full` — 36×36px circular ghost icon buttons (search, bookmark, notifications) with themed (not hardcoded) background/hover tokens.

---

## 6. Copy / Tone

Directly confirmed strings from the live site **[confirmed]**:
- Page `<title>`/meta: **"Polymarket | The World's Largest Prediction Market™"** (note the ™ symbol is part of the actual brand mark).
- Meta description: *"Polymarket is the world's largest prediction market, allowing you to stay informed and profit from your knowledge by trading on future events across various topics."*
- Nav/CTA copy is terse, lowercase-sentence-case, action-first: "How it works", "Log in", "Sign up".
- Percentage copy pattern: **"21% chance"** — lowercase "chance," no colon, no "of" — a consistent minimal-noise phrasing used across the whole product for probability display.
- Footer/utility nav copy confirmed verbatim: `Leaderboard`, `Rewards`, `Learn`, `Docs`, `APIs`, `Careers`, `Press`, `Contact us`, `Help Center`, `Terms of Service` / `Terms of Use`, `Privacy` / `Privacy Policy`, `Market Integrity`, plus social links `𝕏 (Twitter)`, `Discord`, `Instagram`, `TikTok`.
- Filter/utility copy: `Featured markets`, `Markets by category and topics`, `Show more markets`, `View more`, `Active`, `All markets`, `24hr Volume`.
- Notification/reward micro-copy: `"Earn 3.25% holding rewards"` — Polymarket surfaces a specific numeric yield rate directly in a nav icon's `aria-label`, a good example of the site's general pattern of putting a concrete number in front of users rather than vague marketing language ("Vol.", "% chance", "3.25%", dollar-formatted volumes everywhere) — numbers-forward, minimal adjectives.
- No hero "Trade on anything"-style headline was captured verbatim in this pass on the homepage itself (the meta description above is the closest confirmed equivalent); treat the exact "Trade on anything" phrasing from the brief as **[unconfirmed — likely a real historical tagline from marketing pages not fetched in this pass]**.

---

## 7. API Reference (for mimicking the data model)

### 7.1 Gamma API — `https://gamma-api.polymarket.com` (public, no auth)

**`GET /events`** — list events (an event = a real-world question, containing 1+ markets). Query params observed working: `limit`, `order` (e.g. `volume24hr`), `ascending` (bool), `closed` (bool), `live` (bool), `tag_id`.

Key fields on an event object (all directly observed in live responses):
```
id, ticker, slug, title, description, resolutionSource,
startDate, creationDate, endDate, image, icon,
active, closed, archived, new, featured, restricted,
volume, volume24hr, volume1wk, volume1mo, volume1yr, openInterest, liquidity,
enableOrderBook, negRisk, negRiskAugmented, commentCount,
markets: [ ...see below... ],
series: [{ id, ticker, slug, title, seriesType, recurrence, image, icon, volume24hr, liquidity, commentCount }],
competitive, cyom, showAllOutcomes, showMarketImages, enableNegRisk,
eventDate, startTime, seriesSlug, score, period, live, ended, finishedTimestamp, gameId,
pendingDeployment, deploying
```

Key fields on a market object (nested in `event.markets[]`, or directly from `/markets`):
```
id, question, conditionId, slug, resolutionSource, description,
outcomes: '["Yes","No"]' (JSON-stringified array),
outcomePrices: '["0.0005","0.9995"]' (JSON-stringified array, decimal strings summing to 1),
clobTokenIds: '["<uint256>","<uint256>"]' (JSON-stringified array — the two ERC-1155 token IDs),
positionIds: ["<uint256>","<uint256>"],
volume, volumeNum, volume24hr/1wk/1mo/1yr (+ "Clob" suffixed variants),
liquidity, liquidityNum, liquidityClob,
active, closed, archived, restricted, new, featured,
groupItemTitle (row label for multi-outcome cards), groupItemThreshold,
questionID, resolvedBy (an Ethereum address — the UMA resolver),
umaEndDate, umaResolutionStatus ("resolved"|"proposed"|...), umaBond, umaReward, customLiveness,
enableOrderBook, orderPriceMinTickSize (e.g. 0.001), orderMinSize (e.g. 5),
acceptingOrders, comboStatus ("enabled"|...),
makerBaseFee, takerBaseFee,
gameStartTime, secondsDelay,
createdAt, updatedAt, closedTime, endDateIso, startDateIso, hasReviewedDates
```

**`GET /markets`** — flat market list, same field shape as above (each market also carries a nested `events: [...]` back-reference).

**`GET /tags`** — the category taxonomy backing the nav row and chips:
```
id, label, slug, forceShow, publishedAt, createdAt, updatedAt, requiresTranslation
```
(Observed hundreds of granular tags — e.g. `caitlin-clark`, `viktoria-plzen`, `house-races`, `europa-league` — confirming tags are a large, long-tail taxonomy, and the visible nav-row topics are a curated/pinned subset, likely via `forceShow` or a separate "featured tags" concept.)

**`GET /events/slug/{slug}`** — fetch a single event by its URL slug (reported by third-party docs, matches the `slug` field pattern observed on every event, e.g. `wta-korneev-gauff-2026-08-09`, `fed-decision-in-september`). **[reported endpoint shape, consistent with confirmed slug field]**

### 7.2 CLOB API — `https://clob.polymarket.com` (public reads unauthenticated; writes require EIP-712 + L2 auth headers)

**`GET /book?token_id={clobTokenId}`**
```json
{
  "market": "0x<conditionId>",
  "asset_id": "<tokenId>",
  "timestamp": "<ms>",
  "hash": "<string>",
  "bids": [{"price":"0.50","size":"1000"}, ...],
  "asks": [{"price":"0.999","size":"101179"}, {"price":"0.998","size":"5580"}, ...]
}
```
Levels are plain `{price, size}` string pairs; asks sorted ascending by price observed in the live pull.

**`GET /price?token_id={id}&side=buy|sell`** → `{"price": "0.0"}` (best executable price for that side).

**`GET /midpoint?token_id={id}`** → `{"mid": "0.0005"}`.

**`GET /prices-history?market={tokenId}&interval={1d|...}&fidelity={minutes}`** →
```json
{"history": [{"t": 1786233628, "p": 0.235}, {"t": 1786237223, "p": 0.235}, ...]}
```
`t` = unix seconds, `p` = price (0–1). Confirmed live with `interval=1d&fidelity=60` (hourly points over a day); other interval values (`1h`,`6h`,`1w`,`1m`,`max`/`all`) are the expected set matching the UI's timeframe toggle but were **not individually re-tested** in this pass. **[inferred enum, confirmed shape]**

### 7.3 Suggested minimal schema for a replica backend

Based on the above, a replica's core tables map cleanly to:
- `events` (question group) — id, slug, title, description, image/icon, category/tag ids, volume metrics, comment_count, series_id, is_live, score, period.
- `markets` (one row per outcome-pair or per multi-outcome leg) — id, event_id, question, group_item_title, outcomes[], outcome_prices[] (derived, not stored — see order book), yes_token_id, no_token_id, min_tick_size, min_order_size, maker_fee_bps, taker_fee_bps, uma_status, uma_bond, uma_reward, dispute_window_seconds, resolution_source, rules_text.
- `order_book_levels` (or a live matching-engine state) — token_id, side, price, size.
- `price_history` — token_id, ts, price (for chart rendering at multiple fidelities).
- `tags` — id, label, slug, is_pinned/force_show (drives nav row vs. long-tail search).
- `comments` — market/event scoped, threaded, like-count ("you can like only one comment a time" — confirmed literal micro-copy string observed near comment UI, i.e. one-like-per-user enforcement is a real, documented rule surfaced in-product).

---

## 8. Flags / open gaps for the build team

- **Buy/Sell ticket exact copy** ("To win $X", tab labels) — not independently re-confirmed against live markup in this pass; treat as standard/likely-correct but verify before pixel-matching.
- **Gift icon** on card footer — not observed in the specific homepage snapshot pulled; may be conditional/hover-only or a promo-specific affordance. Confirm placement before building.
- **LIVE badge exact color/style** — badge presence and driving field (`live` boolean) are confirmed; the specific badge chip styling (color, pulse animation) was not isolated in the CSS grep pass.
- **Circular gauge ring implementation** — the "21% chance" text treatment is confirmed pixel-for-pixel; the ring graphic itself is inferred (standard SVG progress ring), not directly captured as a discrete CSS/SVG snippet.
- **Full `interval` enum for `/prices-history`** — only `1d` was live-tested; 1H/6H/1W/1M/ALL are assumed but not each individually verified.
- Two overlapping "blue" design-token families exist (`--blue-*` fixed vs. `--brand-*` theme-shifting) — pick one deliberately for the replica rather than mixing both, and note real Polymarket's dark-mode brand blue brightens to `#0093fd`-ish while `blue-500` stays `#1652f0`.

---

## Sources

- [Overview - Polymarket Documentation](https://docs.polymarket.com/api-reference/introduction)
- [The Polymarket API: Architecture, Endpoints, and Use Cases (Medium)](https://medium.com/@gwrx2005/the-polymarket-api-architecture-endpoints-and-use-cases-f1d88fa6c1bf)
- [Polymarket API for Developers: Gamma API, Data, and Polygon RPC (Chainstack)](https://chainstack.com/polymarket-api-for-developers/)
- [Get order book - Polymarket Documentation](https://docs.polymarket.com/api-reference/market-data/get-order-book)
- [Polymarket API Developer Guide 2026 (Rekko)](https://rekko.ai/docs/guides/polymarket-api-guide)
- [The Complete Polymarket API Guide (Prediction Hunt)](https://www.predictionhunt.com/blog/polymarket-api-complete-guide)
- [How Polymarket Disputed Markets Resolve: UMA Oracle Guide (Laika Labs)](https://laikalabs.ai/prediction-markets/polymarket-disputed-markets-uma-oracle-resolution)
- [How Are Prediction Markets Resolved? (Polymarket Help Center)](https://help.polymarket.com/en/articles/13364518-how-are-prediction-markets-resolved)
- [Resolution - Polymarket Documentation](https://docs.polymarket.com/concepts/resolution)
- [Polymarket Fees Explained (KuCoin)](https://www.kucoin.com/blog/polymarket-fees-trading-guide-2026)
- [Trading Fees | Polymarket Help Center](https://help.polymarket.com/en/articles/13364478-trading-fees)
- [Polymarket Fees 2026 (Start Polymarket)](https://startpolymarket.com/learn/polymarket-fees/)
- [Polymarket Set to Launch Combos (CoinGape)](https://coingape.com/block-of-fame/pulse/polymarket-set-to-launch-combos-a-sports-parlay-style-prediction-market-feature/)
- [Polymarket launches combo trading feature (Bitget News)](https://www.bitget.com/amp/news/detail/12560605500754)
- [Polymarket Rolls Out Parlay-Style Combo Trading (BigGo Finance)](https://finance.biggo.com/news/b7aa8901-19b8-4611-bb74-1dfe01da9dd8)
- [Liquidity Rewards | Polymarket Help Center](https://help.polymarket.com/en/articles/13364466-liquidity-rewards)
- [Liquidity Rewards - Polymarket Documentation](https://docs.polymarket.com/market-makers/liquidity-rewards)
- [The Complete Guide to Polymarket LP Farming (Bravado)](https://www.bravadotrade.com/blog/polymarket-lp-farming)
- [Polymarket Unveils Perpetual Futures (Yahoo Finance)](https://finance.yahoo.com/markets/crypto/articles/polymarket-unveils-perpetual-futures-time-183135718.html)
- [Polymarket launches trading of heavily leveraged 'perps' contracts (CNBC)](https://www.cnbc.com/2026/04/21/polymarket-launches-trading-of-heavily-leveraged-perps-contracts.html)
- [Polymarket Perps Push Prediction Markets Deeper Into Crypto](https://bitcoinfoundation.org/news/prediction-markets/polymarket-perps-launch-prediction-markets/)
- Live data pulled directly from `polymarket.com` (HTML/CSS), `gamma-api.polymarket.com`, and `clob.polymarket.com` on 2026-08-09.
