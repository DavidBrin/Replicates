# Bet — Product & UI Specification

> **wanna bet?**
> *make the groupchat put their money where their mouth is*

Bet is a **private, friend-first prediction market**. Where Kalshi and Polymarket run
public markets on world events, Bet runs *your* markets on *your* people: who's actually
showing up Friday, whether Dev ships before the deadline, which of you finishes the
marathon. Bets are private by default and exist inside a group; every bet carries its own
groupchat containing exactly the people with money on it.

A public **Explore** surface — a deliberate blend of Kalshi's and Polymarket's UI — sits
alongside as a separate, read-only destination so the global-markets experience is still
there without diluting the private core.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **User** | A person. Has a unique `@handle`, display name, avatar, and a play-money balance. |
| **Friend** | A symmetric, mutually-accepted relationship. Friend lists are **never** visible to third parties. |
| **Group** | A named circle of friends (e.g. "Sunday League", "The Roommates"). Appears as a **tab**. |
| **Market** | One bet: a question, 2–8 outcomes, a close time, and resolution criteria. Private to its group by default. |
| **Outcome** | One resolvable branch of a market. Binary markets have exactly `Yes` / `No`. |
| **Position** | A user's shares in one outcome of one market. |
| **Trade** | An executed buy or sell against a market's pricing engine. |
| **Credits** | Play money. Symbol `¢redits`, displayed as `1,000` etc. **No real money anywhere.** |
| **Room** | The groupchat attached to a market. Membership = everyone holding (or who has held) a position, plus the creator. |

---

## 2. Information architecture

```
/                       Marketing home — "wanna bet?" hero, slogan, demo sign-in
/app                    Redirects to the user's first group
/app/g/[groupSlug]      GROUP TAB → dashboard: the group's markets
/app/g/[groupSlug]/m/[marketId]
                        Market view: price, question, order ticket, positions, groupchat
/app/new                Create-bet wizard (5 steps)
/app/friends            Friends, requests, username search
/app/activity           Notifications + trade history
/explore                PUBLIC markets — Kalshi × Polymarket styled
/explore/[marketId]     Public market detail (read-only)
/signin                 Demo user picker
```

The **top bar** carries the group tabs. Tabs are group names, left to right, with a `+`
to create a group, and an `Explore` link pinned at the right that navigates to `/explore`
(target `_blank` — it is a separate destination, per the brief).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ⬤ Bet    Sunday League │ The Roommates │ Fantasy 2026 │ +      🔍  🔔  ⬤ me │
├──────────────────────────────────────────────────────────────────────────────┤
│  Markets · Members · Leaderboard                          [ + New bet ]      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Screens

### 3.1 Marketing home `/`

- Full-bleed dark hero. Oversized display type: **"wanna bet?"**
- Sub-slogan: *make the groupchat put their money where their mouth is*
- One primary CTA (`Start betting`) → `/signin`; one secondary (`See public markets`) → `/explore`.
- Three feature panels: **Private by default** · **Priced by your group** · **The chat is the market**.
- A live-looking demo card showing a real seeded market with its probability pill animating.

### 3.2 Group dashboard `/app/g/[slug]`

Header: group name, member avatar stack, member count, `+ New bet`.

Body: a responsive grid of **market cards** (see §5.1) — 1 col mobile, 2 col md, 3 col xl.
Sections in order: `Closing soon` · `Open` · `Awaiting resolution` · `Settled`.

Right rail (xl+): group leaderboard (net credits, 30d), pending invites, recent activity.

### 3.3 Market view `/app/g/[slug]/m/[id]`

Three-region layout at xl (`1fr 360px` with chat as the right column):

```
┌───────────────────────────────────┬──────────────────────┐
│ ← Sunday League                   │  Room · 6 in         │
│ Will Marcus actually run the 10k? │ ┌──────────────────┐ │
│ ● Open · closes Sat 9:00 AM       │ │ maya  2:14pm     │ │
│                                   │ │ he hasn't run    │ │
│  ┌─────────────────────────────┐  │ │ since march lol  │ │
│  │   72%  ▲6                   │  │ │                  │ │
│  │   [price history sparkline] │  │ │ dev   2:15pm     │ │
│  └─────────────────────────────┘  │ │ i'm taking No    │ │
│                                   │ │ 🟢 bought 40 No  │ │
│  Yes 72¢  ·  No 28¢               │ │    @ 29¢         │ │
│  ┌──────────┐ ┌──────────┐        │ └──────────────────┘ │
│  │ Buy Yes  │ │ Buy No   │        │ [ message…      ↵ ] │
│  └──────────┘ └──────────┘        │                      │
│                                   │                      │
│  Your position · Holders ·        │                      │
│  Rules & resolution · Activity    │                      │
└───────────────────────────────────┴──────────────────────┘
```

- **Price header**: current probability of the leading outcome as a large numeral, delta
  chip vs 24h, and a price-history line chart (hand-rolled SVG, one series per outcome).
- **Order ticket**: outcome selector, `Buy`/`Sell` toggle, amount input in credits with
  quick chips (`10 · 25 · 50 · Max`), a live quote showing `shares`, `avg price`,
  `to win`, `price impact`, and a fee line. Submitting re-quotes server-side — the client
  quote is never authoritative.
- **Groupchat (Room)**: messages from market participants, interleaved with **system trade
  events** ("dev bought 40 No @ 29¢") so the chat *is* the tape. Optimistic send with a
  client-generated id; polling refresh with an SSE upgrade path.
- **Positions / Holders**: your shares + avg cost + unrealized P/L; holders list shows
  each participant's side and share count (stake amounts hidden unless the market's
  `stakesVisible` flag is on).
- **Resolution**: creator proposes an outcome → 12h dispute window → auto-finalize, or a
  participant disputes → group quorum vote. See §6.4.

### 3.4 Create-bet wizard `/app/new`

Five steps, draft-persisted on every change so nothing is lost on refresh:

1. **The question** — `question` (≤140), `resolutionCriteria` (≥20 chars, required),
   `resolutionSource` (optional), `closesAt` (must be future).
2. **Outcomes** — Binary `Yes`/`No` by default (one click). "This isn't yes/no" toggle
   reveals a 2–8 outcome list editor.
3. **Pricing** — how the bet gets priced:
   - **Market-priced (default)** — LMSR automated market maker; prices move as people
     buy, exactly like Kalshi/Polymarket. Liquidity `b` derived from the group size.
   - **Set your own odds** — creator states the opening probability per outcome; the
     book then trades peer-to-peer at fixed odds.
   - **Pool (parimutuel)** — everyone stakes, winners split the pot pro-rata.
   Plus `minStake` / `maxStake` and a `stakesVisible` toggle. All have defaults, so the
   step is skippable by pressing Next.
4. **Invite players** — friends listed **first, before any typing**, as tappable chips;
   debounced `@handle` search below; selected invitees shown as removable chips; a
   `Copy invite link` affordance. Non-friends cannot be picked directly (tooltip: "add
   them as a friend first") — link invites are the escape hatch.
5. **Review & create** — read-only summary, each section with an `Edit` jump that
   preserves the other steps. `Create bet` writes market + outcomes + invites in one
   transaction and routes to the new market.

### 3.5 Friends `/app/friends`

Instagram-shaped, with one deliberate difference: **you can never enumerate another
user's friends.**

- Search by `@handle` (debounced, min 2 chars, capped results, rate-limited).
- Tabs: `Friends` · `Requests` (incoming, with Accept/Decline) · `Sent` (with Cancel).
- A user card shows handle, display name, avatar, mutual-group count — never a friend list.

### 3.6 Explore `/explore`

The public surface, styled as an explicit **mix of Kalshi and Polymarket** (see §7.3):
Kalshi's chrome (two-row nav, outlined probability pills, mint accent, ticker-ish
numerics) over Polymarket's dense 4-column card grid with Yes/No action buttons.

- Row 1: logo, search ("Trade on anything"), Sign up, menu.
- Row 2: category tabs — Trending, Politics, Sports, Crypto, Culture, Economics, Climate,
  Tech, Mentions.
- Row 3: chip filters (All, plus topical chips).
- Grid: card variants (a) multi-outcome rows with Yes/No buttons, (b) binary with a
  circular percentage gauge, (c) head-to-head sports with two team buttons.
- Right rail: Trending list, volume hub cards.
- Every card links to a read-only `/explore/[id]` detail with chart + orderbook-style
  depth + rules. **No trading on Explore** — it's a showcase; a banner says so.

---

## 4. Domain model

```ts
User          { id, handle, displayName, avatarColor, avatarInitials, balance: Credits, createdAt }
Friendship    { userAId, userBId, createdAt }              // stored ordered: userAId < userBId
FriendRequest { id, fromId, toId, status: pending|accepted|declined|cancelled, createdAt }
Group         { id, slug, name, emoji, memberIds[], ownerId, createdAt }
Market        { id, groupId|null, creatorId, question, resolutionCriteria, resolutionSource?,
                closesAt, status, visibility: private|group|public,
                pricing: PricingConfig, minStake, maxStake, stakesVisible,
                outcomes: Outcome[], createdAt, resolution?: Resolution }
Outcome       { id, marketId, label, description?, color }
Position      { id, marketId, outcomeId, userId, shares, costBasis: Credits }
Trade         { id, marketId, outcomeId, userId, side: buy|sell, shares, cost, avgPrice, fee, at }
PricePoint    { marketId, at, prices: Record<OutcomeId, number> }
Message       { id, roomId, authorId|null, kind: text|system, body, clientId?, at }
Invite        { id, kind: direct|link, targetType: group|market, targetId, inviterId,
                inviteeId?, tokenHash?, status, expiresAt, createdAt }
Notification  { id, userId, type, payload, readAt?, createdAt }
```

**Market status machine:**
`open → closed → resolving → (disputed →) resolved`, plus `cancelled` from any pre-resolved state.
Trading is permitted only in `open`. Settlement fires exactly once, on entry to `resolved`.

---

## 5. Component specifications

### 5.1 MarketCard (private / group context)

```
┌────────────────────────────────────────────┐
│ ⬤⬤⬤  6 in          closes in 2d       🔖 │   avatars, close countdown
│                                            │
│ Will Marcus actually run the 10k?          │   question, 2-line clamp, 16px/600
│                                            │
│ Yes                    1.39x      ⟨ 72% ⟩  │   outcome row: label · payout · pill
│ No                     3.57x      ⟨ 28% ⟩  │
│ ────────────────────────────────────────── │
│ 1,240 vol · 6 traders            💬 14     │   footer: volume, chat count
└────────────────────────────────────────────┘
```

- Card: `bg: --surface-2`, `border: 1px --border`, `radius: 12px`, `padding: 16px`,
  hover lifts to `--surface-3` with `border-color: --border-2`.
- **Probability pill** (Kalshi's pattern): transparent fill, 1px border at 32% accent
  alpha, solid accent text, `radius: 999px`, `padding: 2px 10px`, tabular numerals.
  Green when >50%, neutral otherwise; the leading outcome's pill is always emphasized.
- Payout multiplier `1/p` to 2dp, muted, tabular.
- Max 3 outcome rows shown, then `+N more`.

### 5.2 OrderTicket

Outcome tabs → side toggle (`Buy`/`Sell`) → amount field → quote panel → submit.
The quote panel updates on every keystroke (debounced 150ms) against
`POST /api/markets/[id]/quote` and shows: `shares`, `avg price`, `to win`, `price impact`,
`fee`. Disabled with a reason string whenever the market isn't `open`, the user lacks
balance, or the amount violates `minStake`/`maxStake`.

### 5.3 ProbabilityChart

Hand-rolled SVG, no chart dependency. One `<path>` per outcome over a 0–100% y-axis,
month/day x-ticks, hover crosshair with a value readout, and a final-point dot per
series (matching Kalshi's chart). Renders server-side safely; interactivity is a thin
client wrapper.

### 5.4 Room (groupchat)

Keyset-paginated message list (`before` cursor), grouped by author with time separators,
system trade events rendered as inline chips rather than bubbles, optimistic sends keyed
by `clientId`, and a composer with `⌘↵` to send. Polls every 4s while the tab is visible;
the transport sits behind a `RealtimeChannel` port so SSE or a hosted provider can drop in.

---

## 6. Pricing & resolution

### 6.1 Engine interface

All strategies implement one interface (`src/domain/pricing/engine.ts`):

```ts
interface PricingEngine {
  currentPrices(state: MarketState): Record<OutcomeId, number>;   // sums to 1
  quote(state: MarketState, order: Order): Quote;                  // pure
  execute(state: MarketState, order: Order): { newState: MarketState; quote: Quote };
  settle(state: MarketState, winning: OutcomeId, positions: Position[]): Payout[];
}
```

Selected per market by `pricing.kind`, resolved through a registry. Quotes are always
recomputed server-side from committed state before execution.

### 6.2 Strategies

| Kind | Use | Core math |
|---|---|---|
| `lmsr` **(default)** | Market-priced bets | `C(q) = b·ln Σ exp(qᵢ/b)`; `pᵢ = softmax(qᵢ/b)`; trade cost `C(q′)−C(q)`; bounded loss `b·ln n`. Implemented with the log-sum-exp shift for numerical stability. |
| `fixedOdds` | "Set your own odds" | Creator fixes opening probabilities; stakes escrow peer-to-peer at those odds; implied probability displayed identically. |
| `parimutuel` | Pool bets | Stakes pool per outcome; payout = `stake / winningPool × (totalPool × (1 − rake))`. |

`b` defaults to `max(50, 12 × expectedParticipants)` so a 6-person group gets meaningful
price movement without wild swings.

### 6.3 Fees

Kalshi's published formula, applied as a rake into the group pot rather than to a house:
`fee = ceil(0.07 × C × P × (1 − P))` where `C` = contracts and `P` = price. Fees are
**off by default** for friend bets (`feeBps: 0`) and shown transparently when on.

### 6.4 Resolution

Creator-proposes → **12h dispute window** → auto-finalize if unchallenged. Any
participant may dispute, which escalates to a **quorum vote** of position holders
(simple majority of those who vote; ties hold the market open). Every state change is
appended to the market's activity log and posted into the Room as a system message.

### 6.5 Invariants (property-tested with fast-check)

1. Prices sum to 1 (±1e-9) for every reachable state.
2. Cost is strictly increasing and convex in share quantity.
3. Buy-then-sell round trip never profits the trader.
4. LMSR house loss ≤ `b·ln n` over any trade sequence, for every winning outcome.
5. Settlement conserves money — payouts never exceed collected cost basis + subsidy.
6. `settle` fires exactly once per market.
7. `quote` and `currentPrices` are pure and deterministic.

---

## 7. Visual design

### 7.1 Bet's own identity (private surface)

Bet is *not* a Kalshi clone or a Polymarket clone — the friend surface has its own voice
so that crossing into `/explore` feels like leaving the house. Cool near-black surfaces
(Polymarket's ramp is the most neutral base), alpha-based text/stroke ramps (Kalshi's
more robust approach), and an **electric indigo/violet accent** that belongs to neither
source. Yes/No keep green/red because that reading is universal.

```css
--surface-0: #0a0b10;   /* page      */
--surface-1: #101218;   /* card      */
--surface-2: #17181c;   /* raised    */
--surface-3: #202227;   /* hover     */
--border:    #ffffff17; /* hairline  */
--border-2:  #ffffff24;
--text-1:    #ecedee;   /* primary   */
--text-2:    #9b9da7;   /* secondary */
--text-3:    #6b6e78;   /* muted     */
--accent:    #7c6cff;   /* Bet indigo */
--accent-2:  #a394ff;
--yes:       #2bae4c;  --yes-bg:  #2bae4c1f;  --yes-br: #2bae4c52;
--no:        #f43437;  --no-bg:   #f434371f;  --no-br:  #f4343752;
--warn:      #efc500;
```

Type: **Inter** (variable) for UI with `cv01,cv02,cv03,cv04,cv11` and tabular numerals on
all money/probability; a heavier weight and tight tracking for display. Radii: `12px`
cards, `8px` inputs, `999px` pills. Grid gap `16px`. Content width `1320px`.

### 7.2 Numeric discipline

Every probability, price, multiplier, credit amount and countdown uses
`font-variant-numeric: tabular-nums`. Probabilities render as whole percents; prices in
cents; credits with thousands separators. A shared `formatters.ts` owns all of it — no
ad-hoc `toFixed` in components.

### 7.3 Explore's borrowed identity

`/explore` deliberately mixes the two sources, per the brief:

| Element | Borrowed from |
|---|---|
| Two-row nav (bar + category strip, 107px total), mint accent `#28cc95`, outlined probability pills, payout multipliers, `$X vol` footers, condensed numerics | **Kalshi** |
| 4-column 346px card grid at 16px gap, chip filter row, per-outcome `Yes`/`No` tinted buttons, circular `21% chance` gauge, head-to-head sports cards with team buttons, right-rail Trending | **Polymarket** |

Explore uses its own token scope (`[data-surface="explore"]`) so the two aesthetics never
leak into each other.

### 7.4 Accessibility

Focus rings on every interactive element (`2px --accent`, 2px offset). Probability is
never conveyed by color alone — the numeral is always present. Contrast ≥ 4.5:1 for body
text. All controls reachable by keyboard; the wizard is fully keyboard-navigable; the
chat composer supports `⌘↵`.

---

## 8. API surface

All routes under `/api`, JSON, with a uniform envelope: `{ data }` or
`{ error: { code, message, fields? } }`. Every input validated with Zod. Every handler
calls `can(actor, action, resource)` before touching data. Unauthorized reads of
existence-sensitive resources return **404, not 403**.

```
POST   /api/session                    sign in as a demo user
DELETE /api/session                    sign out
GET    /api/me                         current user + balance + groups

GET    /api/users/search?q=            handle prefix search (rate-limited, capped)
GET    /api/friends                    my friends
POST   /api/friends/requests           send request
POST   /api/friends/requests/[id]      accept | decline | cancel

GET    /api/groups                     my groups
POST   /api/groups                     create group
GET    /api/groups/[slug]              group + markets
POST   /api/groups/[slug]/members      invite/add member

GET    /api/markets/[id]               market + prices + my position
POST   /api/markets                    create (from wizard)
POST   /api/markets/[id]/quote         price a hypothetical order
POST   /api/markets/[id]/trades        execute a trade
POST   /api/markets/[id]/resolve       propose | dispute | vote | finalize
GET    /api/markets/[id]/history       price points
GET    /api/markets/[id]/messages      keyset-paginated
POST   /api/markets/[id]/messages      post (idempotent on clientId)

GET    /api/invites/[token]            preview a link invite
POST   /api/invites                    create
POST   /api/invites/[id]/accept        accept | decline

GET    /api/explore                    public markets (categories, trending)
GET    /api/notifications              mine
```

---

## 9. Out of scope (v1)

Real money, KYC, payments, mobile apps, push notifications, market editing after close,
public market creation by users, order books on the private surface, image uploads,
and persistent storage beyond the pluggable adapter. See README "Known gaps".
