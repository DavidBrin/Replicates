# Prediction Market Pricing Mechanisms — Implementation Reference

Audience: an engineer building a small friend-group betting app (5–50 participants per
market, thin liquidity, social trust rather than institutional capital). Goal: pick and
implement the right pricing mechanism(s), with formulas that can be typed directly into
code.

Verified against: Kalshi's published fee schedule, Hanson's LMSR papers, the Gnosis
`FixedProductMarketMaker.sol` contract, and Polymarket's CLOB documentation (see inline
citations). All worked numeric examples below were computed by hand/derivation and are
reproducible with the formulas given.

## Table of contents

1. [CLOB (Kalshi / Polymarket style)](#1-clob-central-limit-order-book)
2. [LMSR (Hanson's automated market maker)](#2-lmsr-logarithmic-market-scoring-rule)
3. [CPMM / FPMM (Gnosis-style constant-product AMM)](#3-cpmm--fpmm-constant-product-amm)
4. [Parimutuel pooling](#4-parimutuel-pooling)
5. [Fixed-odds peer-to-peer ("friend bet")](#5-fixed-odds-peer-to-peer-friend-bet)
6. [Recommended architecture](#6-recommended-architecture)
7. [Fee / rake models](#7-fee--rake-models)
8. [Resolution / oracle patterns](#8-resolution--oracle-patterns)
9. [Recommendation summary](#9-recommendation-summary-for-this-app)

---

## 1. CLOB (central limit order book)

This is how Kalshi and Polymarket work. It is the mechanism you should **not** use as
your default for a 5–50 person market — read why at the end of this section — but you
need to understand it because users will compare your app to it.

### 1.1 Contract shape

A binary market has two complementary tokens, **Yes** and **No**. Each settles to
exactly one of:

- `$1.00` if that side wins
- `$0.00` if that side loses

Price is quoted in cents, `1¢`–`99¢` (Polymarket: `$0.01`–`$0.99` in USDC; Kalshi: `1¢`–`99¢`
in USD), and **is** the market's implied probability of that side resolving Yes:

```
implied_probability(side) = price_in_cents / 100
```

A trade at 63¢ says "the market currently prices this outcome at 63% likely."

### 1.2 Yes/No books are mirror images

Because `price(Yes) + price(No) = $1.00` always (a complete set of one Yes + one No
share is redeemable for exactly $1 regardless of outcome), the two order books are not
independent — they are algebraic reflections of each other:

```
Yes bid at price p  ≡  No ask at price (100 - p)
Yes ask at price p  ≡  No bid at price (100 - p)
```

Concretely: **a limit order to buy Yes at 60¢ is economically identical to a limit
order to sell No at 40¢.** A matching engine can (and Polymarket's does) implement only
one real book internally and derive the other, or match a "buy Yes @ 60¢" order
directly against a "buy No @ 40¢" order — the two orders sum to $1.00 collateral, so the
engine mints one Yes token to the first trader and one No token to the second trader out
of a freshly-created complete set. This is confirmed by Polymarket's own docs: a buy-Yes
order at $0.60 and a buy-No order at $0.40 match each other directly because 0.60 + 0.40
= 1.00.

Displayed price is typically the **midpoint** of best bid / best ask, falling back to
last-traded price when the spread is wider than some threshold (Polymarket uses 10¢):

```
mid_price = (best_bid + best_ask) / 2
```

### 1.3 Matching rules

Standard price-time priority (FIFO at each price level):

1. Orders are matched at the **best available price** first (highest bid meets lowest
   ask).
2. Within a price level, earlier orders execute before later ones (time priority).
3. A "market order" is just a limit order priced to cross the book immediately (e.g. buy
   at 99¢ to guarantee a fill against any resting ask).
4. **Partial fills**: if a resting order is larger than the incoming order, the incoming
   order fully fills and the resting order's remaining quantity stays on the book at the
   same price/time priority. If the incoming order is larger, it fills against multiple
   resting orders in price-then-time order, potentially at several different prices
   (this is "walking the book" and is the source of slippage).

```
Example order book (Yes side), thin/typical for a friend-group-sized market:

  ASK   72¢ x 10
  ASK   68¢ x 5
  ------------------- spread
  BID   55¢ x 8
  BID   50¢ x 20

Best bid = 55¢, best ask = 68¢ → spread = 13¢, mid = 61.5¢

A market buy of 12 Yes shares:
  - fills 5 @ 68¢ (exhausts that ask)  = 340¢
  - fills 7 @ 72¢ (partial fill of 10) = 504¢
  avg execution price = 844¢ / 12 = 70.3¢

The buyer paid an average of 70.3¢ despite the "best price" being 68¢ — 2.3¢ of
slippage from walking the book, and the visible "market price" (61.5¢ mid) undersold
the real cost by ~9¢.
```

### 1.4 Why thin books are terrible UX for small groups

- **No liquidity guarantee.** With 5–50 participants and one market open at a time, the
  book is frequently *empty* on one or both sides. There is no market maker obligated to
  quote — someone has to have already placed a resting limit order for you to trade
  against. In a Kalshi/Polymarket-scale market this is fixed by professional market
  makers; a friend group has none.
- **First mover has to guess a price with no reference.** If nobody has quoted yet,
  a user opening a new market sees a blank book and must invent a price — the app has
  no live number to show them.
- **Large step function slippage.** As shown above, with only a handful of resting
  orders at only 2–3 price levels, even a modest trade (12 shares) walks through the
  entire visible depth and produces a materially worse average price than the "current
  price" shown a moment earlier — a bad and confusing experience for casual users.
- **Cancellation risk / stale quotes.** Someone quotes 55¢, walks away, the news
  changes, and now anyone can pick off a stale price — with a small friend group this
  becomes personal and awkward ("you sniped me") rather than an anonymous, ignorable
  event like it is on Kalshi.
- **No one is incentivized to provide liquidity.** Professional CLOB venues attract
  market makers with rebates and volume; a friend-group app has no such economics, so
  the book simply stays empty most of the time unless the app itself acts as counter-
  party — at which point you are no longer really running a CLOB, you are running an
  automated market maker with an order-book skin.

**Conclusion:** CLOB is the right model when you have (or can attract) professional
liquidity providers continuously quoting both sides. For 5–50 friends it produces either
an empty book (no trade possible) or wide/thin books (bad prices). Use an AMM instead
(§2/§3) so there is *always* a price and *always* a counterparty.

---

## 2. LMSR (Logarithmic Market Scoring Rule)

Hanson's automated market maker (1990s/2003). This is the standard choice for
low-liquidity, no-counterparty markets, and should be your **default** engine.

### 2.1 Cost function

For `n` outcomes with cumulative shares issued `q = (q_1, ..., q_n)` and liquidity
parameter `b > 0`:

```
C(q) = b · ln( Σ_i exp(q_i / b) )
```

`C(q)` is the total amount of money the market maker has collected (or would need to
have collected) to have issued the outstanding share vector `q`. It is *not* a price —
it is a potential function. Everything else derives from it.

### 2.2 Instantaneous price (marginal price)

The price of outcome `i` — its current implied probability — is the partial derivative
of `C` with respect to `q_i`:

```
p_i(q) = ∂C/∂q_i = exp(q_i / b) / Σ_j exp(q_j / b)
```

This is exactly the softmax function over `q_i / b`. Properties that fall out for free:

- `p_i ∈ (0, 1)` for all `i` (never exactly 0 or 1 — LMSR always has an interior price,
  which is why the market never "runs dry").
- `Σ_i p_i = 1` always, by construction (softmax normalizes).

### 2.3 Cost of a trade

Buying `Δq_i` shares of outcome `i` (moving `q → q'` where `q'_i = q_i + Δq_i` and all
other components unchanged) costs:

```
cost = C(q') − C(q)
```

This is always well-defined, always positive for a buy, and is what the trader actually
pays — not `p_i · Δq_i`, because price moves *during* the trade (this is the AMM
equivalent of walking a CLOB book, except continuous and deterministic instead of
depending on resting orders).

Selling is the same formula with a negative `Δq_i` — `C(q') − C(q)` will be negative,
i.e. the trader receives money.

**Average execution price** for a trade of size `Δq_i`:

```
avg_price = cost / Δq_i = [C(q') − C(q)] / Δq_i
```

As `Δq_i → 0` this converges to the marginal price `p_i(q)` — consistent with the
derivative relationship above.

### 2.4 Bounded loss

The market operator's (the "house's") worst-case loss, over all possible final
outcomes, starting from `q^0 = 0`, is:

```
max_loss = b · ln(n)
```

This is the single most important LMSR property for a small app: **you know your
maximum exposure in advance, precisely, in closed form, before a single trade
happens.** Contrast with CPMM (§3) where the house's/LP's exposure is a function of how
much liquidity was seeded and how the pool moves — not a fixed number you chose in
advance.

Intuition for the bound: the worst case for the market maker is that every unit of
subsidized "virtual" liquidity ends up owed to the winning side. `C(0) = b·ln(n)` is
exactly the cost of buying the market up to `q^0`'s baseline entropy state, and it is a
theorem (Hanson) that the operator never loses more than this, regardless of trade
sequence or realized outcome, if `q` starts at `0`.

### 2.5 Choosing `b` from expected volume

`b` is a **liquidity/depth** dial, not a probability parameter:

- Larger `b` → prices move less per share traded (deeper market, more subsidy, higher
  max loss `b·ln(n)`).
- Smaller `b` → prices move a lot per share traded (thin market, cheap to subsidize, low
  max loss, but big price swings on small trades — bad UX for the same reason thin CLOB
  books are bad).

Two practical ways to pick `b`:

**(a) From a target max loss.** If you (the app operator) are willing to subsidize at
most `$L` on a market with `n` outcomes:

```
b = L / ln(n)
```

Example: willing to lose at most $25 on a binary (n=2) market → `b = 25 / ln(2) = 25 /
0.6931 = 36.07`.

**(b) From an expected trade size and acceptable price impact.** A useful approximate
rule for a 2-outcome market starting at `p = 0.5`: a single trade of `Δq` shares moves
the price by roughly `Δq / (4b)` for small `Δq` (this comes from the derivative of the
logistic/softmax at its steepest point, `p(1-p) = 0.25` at `p=0.5`, combined with
`dp/dq_i = p_i(1-p_i)/b`). So:

```
b ≈ Δq_target / (4 · Δp_target)
```

Example: you expect typical single trades of ~20 shares (~$20 notional near 50¢) among
your friend group, and want a single such trade to move the displayed price by no more
than ~5 percentage points: `b ≈ 20 / (4 · 0.05) = 100`.

For a small social app, a reasonable starting default is **`b` in the 50–150 range**
for a binary market with expected total volume in the hundreds of dollars — reconcile
whichever `b` you pick against `max_loss = b·ln(n)` and make sure that number is a loss
you (or the app's house account) are actually willing to eat.

### 2.6 Worked example — 2 outcomes

`b = 100`, market opens with `q = (0, 0)` (Yes, No).

```
C(0,0) = 100 · ln(e^0 + e^0) = 100 · ln(2) = 69.315
p_yes = e^0 / (e^0+e^0) = 0.5,  p_no = 0.5      ✓ sums to 1
```

Trader buys 50 Yes shares. New state `q' = (50, 0)`:

```
C(50,0) = 100 · ln(e^(50/100) + e^0)
        = 100 · ln(e^0.5 + 1)
        = 100 · ln(1.64872 + 1)
        = 100 · ln(2.64872)
        = 100 · 0.97407
        = 97.407

cost = C(50,0) − C(0,0) = 97.407 − 69.315 = 28.09
avg_price = 28.09 / 50 = 0.5619  (56.2¢/share)
```

New instantaneous prices:

```
p_yes = e^0.5 / (e^0.5 + 1) = 1.64872 / 2.64872 = 0.6225
p_no  = 1 / 2.64872 = 0.3775                        ✓ sums to 1
```

House's exposure check: max possible loss on this market is `b·ln(2) = 69.31`. The
house has collected $28.09 in exchange for 50 Yes shares; if Yes wins, house owes
`50 × $1 = $50`, net loss so far `$50 − $28.09 = $21.91` — under the $69.31 ceiling, as
guaranteed.

### 2.7 Worked example — 3 outcomes

`b = 50`, three outcomes A/B/C, `q = (0,0,0)`:

```
C(0,0,0) = 50 · ln(3) = 50 · 1.09861 = 54.93
p_A = p_B = p_C = 1/3
```

Trader buys 30 shares of A. `q' = (30, 0, 0)`:

```
C(30,0,0) = 50 · ln(e^0.6 + e^0 + e^0)
          = 50 · ln(1.82212 + 1 + 1)
          = 50 · ln(3.82212)
          = 50 · 1.34066
          = 67.033

cost = 67.033 − 54.93 = 12.10
avg_price = 12.10 / 30 = 0.403  (40.3¢/share)
```

New prices:

```
p_A = 1.82212 / 3.82212 = 0.4768
p_B = p_C = 1 / 3.82212 = 0.2616 each
sum = 0.4768 + 0.2616 + 0.2616 = 1.0000   ✓
```

Max loss ceiling: `b·ln(3) = 50·1.09861 = 54.93`.

### 2.8 Why LMSR is the standard choice for low-liquidity/no-counterparty markets

- **No liquidity provider needed.** Unlike CLOB (needs resting orders) or CPMM (needs an
  LP to seed a real capital pool), LMSR needs only a *virtual* subsidy commitment from
  the operator, bounded and known in advance (`b·ln(n)`). The "house" is always the
  counterparty, so there is *always* a price and *always* a fill — critical when you
  might have only 5 participants and can't assume two of them will independently post
  opposing resting orders.
- **Closed-form, deterministic pricing.** No order matching logic, no empty-book edge
  case, no "no liquidity" error state.
- **Known worst case before you launch a market.** You choose `b`, you know your max
  loss, full stop — this is a much easier thing to reason about and cap per-market or
  per-user than CPMM's "however much the LPs put in, minus fees, depending on how
  lopsided betting gets."
- **Continuous price discovery**, unlike parimutuel (§4), so users can see a live
  probability and exit early by selling back to the market maker at any time.

### 2.9 Numerically stable implementation (log-sum-exp trick)

Naively computing `exp(q_i / b)` overflows in floating point once `q_i / b` gets much
above ~700 (IEEE 754 double overflows at `e^709`), which is easy to hit with even modest
share counts if `b` is small. Always use the **log-sum-exp** rewrite:

```
m = max_i(q_i / b)
C(q) = b · ( m + ln( Σ_i exp(q_i/b − m) ) )
```

Subtracting the max before exponentiating guarantees every term in the sum is
`exp(non-positive number) ∈ (0, 1]`, so the sum can never overflow, and it underflows
only for terms that are genuinely negligible relative to the max (which is fine — they
contribute ~0 to the sum anyway).

```typescript
/**
 * LMSR cost function, numerically stable via log-sum-exp.
 * q: cumulative shares issued per outcome (can be negative if net short is allowed;
 *    typically >= 0 in a simple "buy only" market).
 * b: liquidity parameter (> 0).
 */
function lmsrCost(q: number[], b: number): number {
  const scaled = q.map((qi) => qi / b);
  const m = Math.max(...scaled);
  const sumExp = scaled.reduce((acc, x) => acc + Math.exp(x - m), 0);
  return b * (m + Math.log(sumExp));
}

/**
 * LMSR marginal (instantaneous) prices. Guaranteed to sum to 1 (up to float error).
 */
function lmsrPrices(q: number[], b: number): number[] {
  const scaled = q.map((qi) => qi / b);
  const m = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - m));
  const sumExp = exps.reduce((a, c) => a + c, 0);
  return exps.map((e) => e / sumExp);
}

/**
 * Cost (in the same money unit as b, e.g. dollars) to move outcome `outcomeIdx`
 * by `deltaShares` (positive = buy, negative = sell).
 */
function lmsrTradeCost(
  q: number[],
  outcomeIdx: number,
  deltaShares: number,
  b: number,
): number {
  const qNext = q.slice();
  qNext[outcomeIdx] += deltaShares;
  return lmsrCost(qNext, b) - lmsrCost(q, b);
}
```

**Inverting the cost function (given a fixed budget, how many shares can I buy?)**
There's no closed form for `Δq` given a fixed dollar budget in the multi-outcome case,
but for a **2-outcome market** it can be solved analytically; in general use bisection
or Newton's method on `f(Δq) = lmsrTradeCost(q, i, Δq, b) - budget = 0`, which is
guaranteed to have a unique root because `C` is strictly convex (cost is strictly
increasing and convex in `Δq`):

```typescript
function lmsrSharesForBudget(
  q: number[],
  outcomeIdx: number,
  budget: number,
  b: number,
  tol = 1e-9,
): number {
  let lo = 0;
  let hi = 1; // grow until cost(hi) exceeds budget
  while (lmsrTradeCost(q, outcomeIdx, hi, b) < budget) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const c = lmsrTradeCost(q, outcomeIdx, mid, b);
    if (Math.abs(c - budget) < tol) return mid;
    if (c < budget) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
```

### 2.10 Integer / decimal precision guidance for money

Floating point dollars are a well-known source of reconciliation bugs. Recommended
pattern for this engine specifically:

- **Store shares and `b` as floating point (or a fixed-point decimal type) internally**
  for the `exp`/`ln` math — you cannot avoid floating point for a transcendental
  function, and trying to do LMSR math in integer cents will compound rounding error
  through every `ln`/`exp` call.
- **Round only at the money boundary**, i.e. when a `cost` or `payout` crosses from the
  pricing engine into the ledger: round to the smallest currency unit (cents, or
  micro-dollars if you want sub-cent precision internally) using a single, consistent,
  documented rounding rule — recommend **round-half-up in the house's favor** on buys
  (charge `ceil(cost * 100) / 100`) and **round-down in the house's favor** on sells
  (pay `floor(proceeds * 100) / 100`). This guarantees the house is never fractionally
  short due to rounding, mirroring how Kalshi rounds its fee to a "centicent" in the
  house's favor (see §7).
- **Never let `b` itself carry a rounding error.** `b` is a configuration constant per
  market; store it as a fixed decimal (e.g. `100.00`), not derived from a running
  computation.
- **Reconcile, don't trust.** Maintain a parallel ledger: `sum(all costs charged) -
  sum(all payouts made) - sum(fees collected)` must equal the house's running cash
  position for that market at all times; assert this in tests and, ideally, in a
  background job. If LMSR math and ledger math ever disagree by more than one rounding
  unit, that is a bug, not "acceptable float drift."
- **Use `number` (double) in TS/JS for the LMSR math** — 64-bit float has ~15-17
  significant decimal digits, vastly more than needed for `q/b` ratios you'll see in a
  friend-group app (share counts in the tens-to-thousands, `b` in the tens-to-hundreds).
  Reach for a big-decimal library only if you expect share counts or `b` large enough to
  push `q/b` into the thousands (unlikely at this scale) or if you need audit-grade
  determinism across languages/runtimes.

---

## 3. CPMM / FPMM (constant-product AMM)

Gnosis's Fixed Product Market Maker (FPMM, used in Omen), adapting Uniswap's `x·y=k`
model to prediction-market outcome tokens.

### 3.1 Mechanics

Instead of a virtual subsidy (`b`), the pool holds **real reserves** of each outcome
token, seeded by liquidity providers (LPs) who deposit collateral. Depositing collateral
`x` mints `x` units of *every* outcome token (a "complete set," since 1 Yes + 1 No is
always redeemable for $1 regardless of outcome) and adds them to the pool. LPs typically
then withdraw some of one side to set an initial price skew, or the pool simply starts
balanced (50/50 for a binary market).

**Invariant:** the product of all outcome-token pool balances is held constant across a
trade (before fees):

```
∏_i poolBalance_i = k   (constant, barring new LP deposits/withdrawals or fees)
```

**Price of outcome `i`** (from the actual Gnosis contract's odds calculation — verified
against `FixedProductMarketMaker.sol`):

```
oddsWeight_i = ∏_{j≠i} poolBalance_j
p_i = oddsWeight_i / Σ_k oddsWeight_k
```

For a binary market this collapses to the familiar form:

```
p_yes = poolBalance_no / (poolBalance_yes + poolBalance_no)
p_no  = poolBalance_yes / (poolBalance_yes + poolBalance_no)
```

Note this is the *opposite* pool's balance in the numerator — a *larger* Yes reserve
means Yes is *cheaper* (more supply), which is correct: the pool balance is inventory of
unsold shares, not money.

**Buying outcome `i` with collateral amount `x` (post-fee, `n=2` case), derived from the
contract's invariant-preservation logic:**

```
k = poolBalance_yes · poolBalance_no          (before trade)
newPoolBalance_other = poolBalance_other + x  (collateral minted into every pool)
endingPoolBalance_i = k' / newPoolBalance_other
   where k' = ∏_all poolBalances (original product, preserved absent fees)
sharesOut = (poolBalance_i + x) − endingPoolBalance_i
```

### 3.2 Worked example

Binary market, LP seeds with 200 units on each side (balanced, 50/50 start):

```
poolBalance_yes = 200, poolBalance_no = 200
k = 200 × 200 = 40,000
p_yes = 200 / 400 = 0.5,  p_no = 0.5             ✓
```

Trader buys Yes with $50 collateral (ignore fees for this pass):

```
newPoolBalance_no = 200 + 50 = 250
endingPoolBalance_yes = k / newPoolBalance_no = 40,000 / 250 = 160
sharesOut = (200 + 50) − 160 = 90

cost = $50, sharesOut = 90 Yes shares
avg_price = 50 / 90 = $0.5556 (55.6¢/share)
```

New pool: `yes = 160, no = 250`. Check invariant: `160 × 250 = 40,000` ✓ (preserved,
as expected with no fee).

New instantaneous price:

```
p_yes = 250 / (160+250) = 250/410 = 0.6098
```

Price moved from 50¢ → 61.0¢ on a $50 trade against $400 total pool depth — a large
move, illustrating how thin CPMM pools produce large price impact just like thin CLOB
books do (§1.4). With a *deeper* pool (say seeded at 2,000/2,000 instead of 200/200),
the same $50 trade would move the price by roughly 1/10th as much — CPMM price impact
scales with `1/poolSize`, same qualitative shape as LMSR's `1/b`.

### 3.3 CPMM vs. LMSR

| | LMSR | CPMM/FPMM |
|---|---|---|
| Who bears the loss | Operator, via a chosen virtual subsidy `b` | LPs, via their real deposited capital |
| Max loss known in advance | Yes, exactly: `b·ln(n)` | Bounded by LP capital at risk, but not a number you *choose* independently of how much people deposit |
| Capital required to launch a market | None (virtual subsidy) | Real money from an LP (someone has to seed the pool) |
| Depth source | `b` (a config number) | Pool reserves (grows only if LPs add more) |
| Fee destination | N/A or goes to house | LP fee income (compensates for the loss risk) |
| Behavior with many outcomes (`n` large) | Max loss grows only as `ln(n)` — very mild | Each additional outcome needs its own reserve seeded; more capital-intensive |
| Best fit here | **Yes** — no LP required, bounded and known operator risk, works from zero volume | Worse fit unless you want *users* (not the app) to be the liquidity backers and earn fee income for it |

**When CPMM is better:** you want actual users to provide and profit from liquidity
(fee income), you're comfortable requiring someone to seed real capital before a market
can trade, and/or you want a mechanism whose economic security has been extensively
battle-tested on-chain (Polymarket/Omen use variants of this at scale). It also
generalizes cleanly to many outcomes without the operator's tail-risk growing (LPs' risk
is bounded by what they put in, period).

**When CPMM is worse (this app):** with 5–50 friends, you cannot assume anyone wants to
lock up real capital as an LP before a market can even open — that's a much higher bar
than "b is a config number the app operator sets once." LMSR lets a market go live at
`t=0` with zero deposited liquidity beyond the operator's own risk tolerance.

---

## 4. Parimutuel pooling

Used by horse-racing tote boards and many "prediction pool" apps. No live market maker
at all — bettors simply pool stakes into buckets per outcome, and the pool is divided
among winners after the fact.

### 4.1 Formulas

```
pool_i        = total money staked on outcome i
total_pool    = Σ_i pool_i
net_pool      = total_pool × (1 − rake)          // rake = platform's cut, e.g. 0.05

For a bettor who staked `s` on the winning outcome k:
payout = (s / pool_k) × net_pool
       = s × [net_pool / pool_k]                  // "net_pool / pool_k" is the effective payout multiplier
profit = payout − s
```

Live (non-binding) implied probability, useful for a UI even though it isn't tradeable:

```
implied_probability_i(t) = pool_i(t) / total_pool(t)
```

### 4.2 Worked example

Three outcomes A/B/C. Final pools before close: `A = $500, B = $300, C = $200`,
`total_pool = $1,000`, rake = 5%.

```
net_pool = 1,000 × 0.95 = $950
```

If A wins: payout multiplier = `net_pool / pool_A = 950 / 500 = 1.90x`.

A bettor who staked $50 on A gets `50 × 1.90 = $95` (profit $45).
A bettor who staked $50 on B (losing side) gets $0 (loses the $50 stake).

Live implied probabilities before close (say at the moment those pool sizes existed):
`p_A = 500/1000 = 50%`, `p_B = 30%`, `p_C = 20%` — but these are **not tradeable
prices**; they only describe crowd sentiment, and shift every time someone else bets,
diluting or improving your own eventual payout multiplier without you having agreed to
that change.

### 4.3 Pros / cons vs. LMSR

**Pros:**
- **No counterparty risk for the operator.** The operator never owes more than what was
  staked, minus rake, ever — payouts are drawn strictly from the pool. There is no
  `b·ln(n)`-style subsidy to fund and no scenario where the house loses money on net
  (rake is a guaranteed skim, not a risk position).
- **No liquidity/subsidy needed to launch.** Like LMSR, no LP capital is required —
  unlike LMSR, the operator also isn't on the hook for anything.
- **Simple to reason about and implement** — it's arithmetic, no transcendental
  functions, no numerical stability concerns.

**Cons:**
- **No live price discovery / no locked execution price.** A CLOB or AMM gives you a
  price *at the moment you trade* and that price is yours. Parimutuel gives you only a
  *provisional* multiplier that keeps changing as more people bet — you don't know your
  real payout ratio until the pool closes. This is a materially worse experience for
  anyone who wants to "buy in early at a good price" the way they can on Kalshi/
  Polymarket or your own LMSR market.
- **No ability to exit early.** Once staked, a parimutuel bettor cannot sell back —
  there's no market maker or counterparty to sell to, and no reason for other bettors to
  buy you out (buying you out would just mean staking into the same pool, which they can
  already do directly). LMSR and CPMM both support sell-back/exit at any time up to
  resolution; parimutuel structurally cannot.
- **Sentiment displayed is not a probability estimate people can act on** — betting late
  after a strong favorite has emerged gives worse odds proportionally (fewer $ per
  winning $ in the pool), which can create a rush-to-bet-early dynamic that's confusing
  for casual users compared to an AMM's simple "current price" number.

**Verdict for this app:** good as a secondary mode for markets where you explicitly
*don't* want live trading/exit (e.g., a one-shot squares pool, bracket-style contests,
or anywhere the "no early exit, simple pooled payout" framing is a feature, not a bug),
but it should not be the default for markets where users expect to trade in and out like
they would on Kalshi/Polymarket.

---

## 5. Fixed-odds / peer-to-peer "friend bet"

The simplest mechanism, and often the most emotionally legible for a friend group: A
states odds, B accepts, stakes are escrowed, no market maker or pool at all — a single
bilateral bet.

### 5.1 Structure

- User A proposes: "I'll bet you the Lakers win, giving 2:1 odds" (meaning: if the
  Lakers win, A pays B twice B's stake; if they lose, B's stake goes to A).
- User B accepts with a stake `s_B`.
- A must escrow enough to cover the payout: if odds are `d:1` in B's favor (B risks 1 to
  win d), A escrows `s_B × d` and B escrows `s_B`. Total pot = `s_B × (1 + d)`.
- On resolution, the entire pot goes to the winner (minus any platform fee, §7).

```typescript
interface FriendBet {
  proposerId: string;
  counterpartyId: string;
  outcomeDescription: string;
  decimalOdds: number;     // odds offered TO the counterparty, decimal format
  counterpartyStake: number;
  proposerEscrow: number;  // = counterpartyStake * (decimalOdds - 1)
}
```

### 5.2 Odds format conversions

Three common odds notations, all convertible to/from **decimal odds** `d` (total payout
per unit staked, i.e. stake × d = amount received back including the original stake):

```
implied_probability = 1 / d
```

**Decimal ↔ American:**

```
if d >= 2.0:  american = (d - 1) × 100          // e.g. d=3.0 → +200
if d <  2.0:  american = -100 / (d - 1)          // e.g. d=1.5 → -200

if american > 0:  d = 1 + american/100           // e.g. +150 → d = 2.50
if american < 0:  d = 1 + 100/|american|          // e.g. -150 → d = 1.667
```

**Decimal ↔ Fractional** (`num/den`, e.g. `5/2`):

```
d = 1 + num/den            // 5/2 → 1 + 2.5 = 3.5
num/den = d - 1            // reduce to lowest terms for display
```

**Worked conversion table:**

| Decimal | American | Fractional | Implied probability |
|---|---|---|---|
| 1.50 | −200 | 1/2 | 66.7% |
| 2.00 | +100 | 1/1 (evens) | 50.0% |
| 3.00 | +200 | 2/1 | 33.3% |
| 1.91 | −110 | 10/11 | 52.4% |

### 5.3 Vig / overround

A single friend bet (one proposer, one acceptor, one set of odds) has **no vig** — it's
a private, no-margin agreement. Vig/overround becomes relevant the moment you display a
**two-sided book** (odds for both outcomes) and want to know if it's "fair":

```
overround = Σ_i (1 / d_i) − 1
```

Example: a market offers Yes at decimal odds 1.91 and No at decimal odds 1.91.

```
implied_yes = 1/1.91 = 0.5236
implied_no  = 1/1.91 = 0.5236
overround = 0.5236 + 0.5236 − 1 = 0.0472  → 4.72% vig
```

**Normalizing an overround book to a fair (probability-summing-to-1) estimate:**

```
p_i_fair = implied_i / Σ_j implied_j
```

Continuing the example:

```
p_yes_fair = 0.5236 / (0.5236+0.5236) = 0.5000
p_no_fair  = 0.5000
```

(In this symmetric example the vig cancels out evenly; with asymmetric odds, e.g. Yes
at 1.80 and No at 2.05, the same normalization step is what lets you display a single
"the market thinks it's 53% likely" number instead of two odds that individually sum to
more than 100%.)

**Use in this app:** display friend bets and any book-style fixed-odds market by
showing `p_i_fair` as "implied probability" so it's comparable to the AMM markets, while
keeping the raw offered odds (with vig, if any) as what actually gets escrowed and paid.
For pure 1:1 peer bets there's no vig by default — only add one if you want the platform
to take a cut on P2P bets, in which case make it explicit (e.g., "we shave 2% off the
loser's stake") rather than hiding it inside skewed odds.

---

## 6. Recommended architecture

A single `PricingEngine` interface, with LMSR as the default implementation and
Parimutuel / FixedOddsP2P / CLOB as swappable strategies selected per market at creation
time.

### 6.1 Interface sketch

```typescript
type OutcomeId = string;

/** Opaque per-market state, shape depends on the strategy. */
type MarketState =
  | { kind: "lmsr"; b: number; q: Record<OutcomeId, number> }
  | { kind: "cpmm"; fee: number; reserves: Record<OutcomeId, number> }
  | { kind: "parimutuel"; rake: number; pools: Record<OutcomeId, number> }
  | { kind: "fixedOddsP2p"; bets: FriendBet[] }
  | { kind: "clob"; book: OrderBook };

interface Order {
  outcomeId: OutcomeId;
  side: "buy" | "sell";
  /** Either specify a share quantity or a money budget, not both. */
  shares?: number;
  budget?: number;
  /** CLOB only: limit price in [0,1]. Omit for AMM strategies (price is derived). */
  limitPrice?: number;
}

interface Quote {
  shares: number;        // shares that would be bought/sold
  cost: number;           // total money in (buy, positive) or out (sell, negative-of-cost convention: money received)
  avgPrice: number;        // cost / shares
  priceImpact: number;     // (postTradePrice - preTradePrice) / preTradePrice
  feePaid: number;
}

interface Payout {
  userId: string;
  amount: number;
}

interface PricingEngine {
  /** Pure, side-effect-free: what WOULD this order cost, at current state? */
  quote(state: MarketState, order: Order): Quote;

  /** Apply the order, returning the new state and the realized quote (should match
   *  quote() called just before, modulo any race — always re-derive from committed
   *  state, never trust a client-supplied quote as authoritative). */
  execute(state: MarketState, order: Order): { newState: MarketState; quote: Quote };

  /** Current displayable prices for every outcome. Must sum to 1 (AMM strategies) or
   *  be the appropriate analogous read (implied prob for parimutuel/CLOB mid). */
  currentPrices(state: MarketState): Record<OutcomeId, number>;

  /** Settlement: given the final state and the winning outcome, compute every
   *  position-holder's payout. Must be a pure function of (state, winningOutcomeId,
   *  positions ledger) — never has side effects itself; caller applies the payouts
   *  transactionally and marks the market settled exactly once. */
  settle(
    state: MarketState,
    winningOutcomeId: OutcomeId,
    positions: Position[],
  ): Payout[];
}
```

### 6.2 LMSR strategy implementation sketch

```typescript
const lmsrEngine: PricingEngine = {
  quote(state, order) {
    if (state.kind !== "lmsr") throw new Error("wrong strategy");
    const { b, q } = state;
    const outcomes = Object.keys(q);
    const qArr = outcomes.map((o) => q[o]);
    const idx = outcomes.indexOf(order.outcomeId);
    const pricesBefore = lmsrPrices(qArr, b);

    const deltaShares =
      order.shares !== undefined
        ? order.shares * (order.side === "sell" ? -1 : 1)
        : lmsrSharesForBudget(qArr, idx, order.budget!, b) *
          (order.side === "sell" ? -1 : 1);

    const cost = lmsrTradeCost(qArr, idx, deltaShares, b);
    const qAfter = qArr.slice();
    qAfter[idx] += deltaShares;
    const pricesAfter = lmsrPrices(qAfter, b);

    return {
      shares: Math.abs(deltaShares),
      cost,
      avgPrice: cost / deltaShares,
      priceImpact:
        (pricesAfter[idx] - pricesBefore[idx]) / pricesBefore[idx],
      feePaid: 0, // fees layered separately, see §7
    };
  },

  execute(state, order) {
    if (state.kind !== "lmsr") throw new Error("wrong strategy");
    const quote = this.quote(state, order);
    const outcomes = Object.keys(state.q);
    const idx = outcomes.indexOf(order.outcomeId);
    const deltaShares =
      quote.shares * (order.side === "sell" ? -1 : 1);
    const newQ = { ...state.q };
    newQ[order.outcomeId] = state.q[order.outcomeId] + deltaShares;
    return { newState: { ...state, q: newQ }, quote };
  },

  currentPrices(state) {
    if (state.kind !== "lmsr") throw new Error("wrong strategy");
    const outcomes = Object.keys(state.q);
    const prices = lmsrPrices(outcomes.map((o) => state.q[o]), state.b);
    return Object.fromEntries(outcomes.map((o, i) => [o, prices[i]]));
  },

  settle(state, winningOutcomeId, positions) {
    // Each share of the winning outcome pays $1; all other shares pay $0.
    return positions.map((p) => ({
      userId: p.userId,
      amount: p.outcomeId === winningOutcomeId ? p.shares * 1.0 : 0,
    }));
  },
};
```

### 6.3 Invariants and property tests worth writing

These should be **property-based tests** (e.g. fast-check), run against every strategy
implementation through the same shared invariant suite so a bug in a new strategy (say,
CPMM added later) gets caught by the same tests LMSR already passes:

1. **Prices sum to 1.** For any reachable `state`, `Σ currentPrices(state) == 1 ±
   epsilon` (AMM strategies). For parimutuel, `Σ impliedProbability == 1` by
   construction (sanity check the arithmetic, not really a deep invariant). For CLOB,
   `bestBid(yes) + bestAsk(no) <= 1` and vice versa should hold in a non-crossed, non-
   arbitrageable book.
2. **Cost monotonicity / convexity.** For fixed `outcomeId`, `cost(Δq)` must be strictly
   increasing in `Δq`, and the *marginal* cost (derivative) must be non-decreasing —
   i.e. buying the 51st share never costs less than buying the 50th. Property test:
   generate random `q`, random increasing sequence of `Δq` values, assert
   `quote(Δq_i).cost` is monotonically increasing and the *average* price
   (`cost/Δq`) is monotonically non-decreasing in `Δq`.
3. **No free money / round-trip loss.** Buying `x` shares then immediately selling `x`
   shares back (no other trades in between, no fee) must return **exactly** the amount
   paid, within floating-point tolerance — never *more*. With a fee layered on, the
   round trip must lose money (fee > 0), never break even or profit. This is the single
   highest-value test for catching a sign error in the cost function — it would have
   caught, for example, an accidentally-inverted `C(q') - C(q)` vs `C(q) - C(q')`.
   ```typescript
   test("round trip never profits", () => {
     fc.assert(
       fc.property(arbMarketState, arbOutcomeId, arbPositiveShares, (state, oid, shares) => {
         const buy = engine.execute(state, { outcomeId: oid, side: "buy", shares });
         const sell = engine.execute(buy.newState, { outcomeId: oid, side: "sell", shares });
         const netCost = buy.quote.cost + sell.quote.cost; // sell cost should be negative
         expect(netCost).toBeGreaterThanOrEqual(-1e-9); // never net-negative cost (= profit) to the trader
       }),
     );
   });
   ```
4. **Bounded loss.** For LMSR specifically: simulate arbitrary sequences of trades from
   `q=0`, then for *every* possible winning outcome, compute
   `houseLoss = totalPayoutIfOutcomeWins - totalCostCollected`, and assert
   `houseLoss <= b * ln(n) + epsilon` for all of them, for all trade sequences the
   property test can generate.
5. **Conservation of money at settlement.** `Σ Payout.amount` over all positions must
   equal exactly `Σ shares(winningOutcomeId) × $1` (LMSR/CPMM) or `net_pool` distributed
   proportionally with no leftover cents beyond an accounted-for rounding remainder
   (parimutuel) — and this total must never exceed what was actually collected into the
   ledger (cost basis + operator subsidy, minus fees already taken). Assert no payout
   run can mint money that was never deposited.
6. **Settle is idempotent / single-fire.** Calling `settle` twice (or the caller
   applying its output twice) must be guarded at the application layer — test that a
   market's `status` transitions `open → settling → settled` exactly once and a second
   settle attempt is rejected, not silently re-paid.
7. **Determinism.** `currentPrices(state)` and `quote(state, order)` must be pure
   functions — same inputs, same outputs, no hidden clock/random dependence — critical
   for reproducing a disputed price after the fact (see §8) and for being able to
   replay/audit a market's full price history from its event log.
8. **CLOB-specific: price-time priority and no self-crossing.** A resting order at a
   better price must always be matched before a worse one at the same or better time;
   an incoming order must never fill against a worse price while a better one is
   available; and the book must never end up in a crossed state (`bestBid >= bestAsk`)
   after matching completes — a crossed book is itself a bug (should have matched).

---

## 7. Fee / rake models

| Model | Formula | Used by |
|---|---|---|
| Flat % of pool (parimutuel) | `rake = total_pool × rakeRate` | Tote boards, squares pools |
| Flat % of trade notional (CPMM/LP fee) | `fee = tradeAmount × feeRate`, taken before the invariant swap, credited to LPs | Uniswap-style AMMs, Omen |
| Uncertainty-weighted per-contract fee (Kalshi) | `fee = ceil_to_centicent(0.07 × C × P × (1−P))` (taker); `0.0175 × C × P × (1−P)` (maker) | Kalshi |
| Flat spread markup (LMSR variant) | charge `cost × (1+spread)` on buys, pay `proceeds × (1−spread)` on sells | Custom LMSR deployments wanting revenue without changing `b` |

### 7.1 Kalshi's fee, in detail

```
fee = round_up( M × 0.07 × C × P × (1 − P) )
```

where `C` = number of contracts traded, `P` = price of the contract expressed as a
dollar probability (e.g. `0.50` for a 50¢ contract), `M` = contract multiplier (1 for
standard markets), and `round_up` rounds the total (fee + trade cost) up to the nearest
"centicent" (i.e. rounds in the *house's* favor, same principle recommended in §2.10).
Maker orders (resting liquidity) pay a quarter of the taker rate: `0.0175` instead of
`0.07`.

The `P × (1−P)` term is the key design idea worth stealing: it is the **variance of a
Bernoulli outcome**, maximized at `P=0.5` (`0.25`) and shrinking to `0` as `P→0` or
`P→1`. The fee is therefore highest exactly where uncertainty (and thus the value the
market maker/exchange is providing) is highest, and drops toward zero for near-certain
contracts where trading barely matters. This is a much better-shaped fee than a flat
percentage of notional, because a flat fee on a 99¢ near-certainty contract is nearly
all fee relative to the tiny amount of real uncertainty being traded.

```
Fee table for a $1-notional (C=1, P as decimal probability) taker trade:

  P = 0.50 → fee = 0.07 × 1 × 0.50 × 0.50 = 0.0175  (1.75¢, the maximum)
  P = 0.30 → fee = 0.07 × 1 × 0.30 × 0.70 = 0.0147
  P = 0.10 → fee = 0.07 × 1 × 0.10 × 0.90 = 0.0063
  P = 0.02 → fee = 0.07 × 1 × 0.02 × 0.98 = 0.00137
```

```typescript
function kalshiStyleFee(
  contracts: number,
  priceProbability: number, // 0..1
  rate = 0.07,
  multiplier = 1,
): number {
  const raw = multiplier * rate * contracts * priceProbability * (1 - priceProbability);
  return Math.ceil(raw * 10000) / 10000; // round up to the nearest centicent ($0.0001)
}
```

**Recommendation for this app:** adopt the `P×(1−P)` shape for any per-trade fee layered
on top of LMSR (§2) or CPMM (§3) — it naturally charges more when the market is most
uncertain (most "trading" is happening) and least when it's nearly resolved, which both
matches user intuition and avoids taxing someone buying a 98¢ near-lock down to
nothing. For parimutuel and P2P friend bets, a flat rake percentage (§4/§5) is simpler
and appropriate since there's no live price to weight against.

---

## 8. Resolution / oracle patterns

For a social app the "oracle" is people, not data feeds — the question is how much
process to wrap around trusting them.

### 8.1 Patterns, from simplest to most robust

1. **Creator resolves.** The market creator marks the winning outcome after the event.
   - *Pro:* trivial to implement, fast, fine for low-stakes/high-trust groups.
   - *Con:* single point of failure/bias — creator may be unavailable, biased (e.g. bet
     on the outcome themselves), or simply wrong; no recourse for participants who
     disagree.
2. **Multi-party attestation / quorum vote.** N designated resolvers (or all
   participants) vote on the outcome; resolution requires a quorum (e.g. majority, or
   `k`-of-`n`) to agree before it's final.
   - *Pro:* removes single-point bias; participants trust a result they collectively
     confirmed.
   - *Con:* requires enough engaged voters to reach quorum — with only 5–50 users and
     casual engagement, quorum can stall a resolution indefinitely if people don't vote.
3. **Dispute window.** A proposed resolution (from a creator or a quorum) is posted, and
   stands after `T` hours unless someone formally disputes it. Disputing escalates to a
   fallback process (see below).
   - *Pro:* fast in the common case (nobody disputes an obvious result), only pays the
     cost of a slower process when there's actual disagreement.
   - *Con:* needs a fallback path for the dispute case, and a sensible window length
     (too short and people miss the chance to object; too long and payouts are stuck).
4. **UMA-style optimistic oracle.** A proposer posts an answer plus a bond; if
   unchallenged within a window, it finalizes and the bond is returned. If challenged
   (challenger posts a matching bond), it escalates to a broader vote/arbitration (UMA
   escalates to its token-holder DVM; a token-less clone would escalate to a fixed panel
   or a full participant vote), and the loser of the dispute forfeits their bond to the
   winner (and often a cut to whoever adjudicated).
   - *Pro:* strongest guarantees, economically disincentivizes frivolous disputes
     (loser pays) and lazy/false proposals (proposer risks their bond).
   - *Con:* meaningful implementation weight (bond escrow, challenge flow, arbitration
     panel) — overkill in a small trusted group where the "cost" of a wrong resolution
     is a friend group being annoyed, not real financial fraud at scale.

### 8.2 Recommended design for this app

Given 5–50 participants who mostly know each other (i.e., real reputational cost to
resolving dishonestly, unlike an anonymous on-chain market), use a **hybrid of #1 and
#3**, with #2 as the fallback rather than the default path:

```
1. Creator (or a designated "resolver" role) proposes the winning outcome, attaching
   evidence (a link, screenshot, or free-text justification) — require this field, it
   materially reduces disputes because it forces the resolver to point at something
   checkable.
2. Open a dispute window (recommend 24-48h for casual social stakes; shorter for
   time-sensitive markets like live sports).
3. During the window, ANY participant with a position in the market can dispute with a
   required reason (free text; a stake/bond is optional polish, not necessary at this
   scale — the social cost of a bad-faith dispute among friends is usually deterrent
   enough).
4. If undisputed at window close: resolution finalizes automatically, payouts settle.
5. If disputed: escalate to a quorum vote among all participants who held a position in
   the market (they have skin in the game and were already trusted enough to bet);
   require a clear majority (e.g. >50% of position-holders who vote, with a minimum
   participation floor, e.g. at least half of position holders must vote or the dispute
   defaults to the ORIGINAL creator's proposal after a longer grace period, to avoid a
   deadlocked market with no path to settlement).
6. Record every resolution (proposal, evidence, dispute reason if any, vote tally) in an
   immutable-ish log attached to the market — this is what makes the process legible and
   is what people actually check when a resolution feels wrong ("why did this settle
   this way") after the fact.
```

This gets you: fast, low-friction resolution in the (vast majority) uncontested case;
a real, low-implementation-cost fallback that doesn't require bonds/tokens/arbitration
infrastructure; and an audit trail, all sized appropriately for a friend-group app where
the failure mode you're actually defending against is "someone genuinely disagrees with
an ambiguous call," not "a well-funded adversary tries to manipulate an oracle for
profit" (which is the threat model UMA's bond-and-escalate design is built for, and
which doesn't apply at your scale/stakes).

---

## 9. Recommendation summary for this app

- **Default engine: LMSR**, `b` chosen per-market from a target max-loss (§2.5),
  implemented with the log-sum-exp-stable cost function (§2.9), money rounded at the
  ledger boundary only (§2.10).
- **Parimutuel** as an opt-in mode for "pool bet, no live trading" market types (squares,
  bracket pools) where locking in an early price is explicitly not a feature you want.
- **Fixed-odds P2P** for one-off bilateral bets between two named users, displayed via
  the implied-probability conversion (§5.2) so it's visually consistent with LMSR
  markets elsewhere in the app.
- **CLOB**: don't build one for v1. If you ever add professional/serious traders who
  want to post resting limit orders and you can guarantee enough participants per market
  to keep a book alive, it becomes worth it — not before.
- **CPMM**: skip unless you specifically want users to act as liquidity providers and
  earn fee income for it; adds real-capital and seeding requirements LMSR avoids.
- **Fees**: `P×(1−P)`-weighted per-trade fee (Kalshi-style, §7.1) on AMM markets; flat
  rake on parimutuel/P2P.
- **Resolution**: creator-proposes + dispute-window + participant-quorum-fallback
  (§8.2) — no bonds/tokens needed at this scale.
- **Architecture**: one `PricingEngine` interface (§6.1) with LMSR/parimutuel/
  fixedOddsP2p (and CLOB later, if ever) as pluggable strategies sharing one
  property-based invariant test suite (§6.3) so every strategy is held to the same
  correctness bar (prices sum to 1, cost monotonicity, no round-trip profit, bounded
  loss, conserved money at settlement).

---

### Sources consulted

- [Kalshi Fee Schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf)
- [Implementing Hanson's Market Maker — Oddhead Blog](http://blog.oddhead.com/2006/10/30/implementing-hansons-market-maker/)
- [Logarithmic Market Scoring Rule — Cultivate Labs](https://www.cultivatelabs.com/crowdsourced-forecasting-guide/how-does-logarithmic-market-scoring-rule-lmsr-work)
- [A General Theory of Liquidity Provisioning for Prediction Markets (arXiv)](https://arxiv.org/pdf/2311.08725)
- [gnosis/conditional-tokens-market-makers — FixedProductMarketMaker.sol](https://github.com/gnosis/conditional-tokens-market-makers/blob/master/contracts/FixedProductMarketMaker.sol)
- [Polymarket Documentation — Prices & Orderbook](https://docs.polymarket.com/concepts/prices-orderbook)
