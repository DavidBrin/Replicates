# Prior art: clones, successors, and how you render 160,000 clickable cells

Research lane 2. Surveys every open-source pixel-marketplace we could find, plus the
r/place family of large-canvas engines, and pulls out the two questions that actually
determine this project's architecture: **how do you render the grid**, and **how do you
store who owns what**.

Confidence tags as in `original-site.md`.

---

## 1. Direct clones

### MillionDollarScript (PHP + MySQL, GPL, still maintained)

The script that powered most of the mid-2000s copycat sites. **HIGH**

- **Rendering:** no client-side cleverness at all. PHP's GD library composites the whole
  grid into a PNG server-side, written to disk, and regenerated as a batch step *after* an
  operator approves a purchase. The browser is handed one image.
- **Ownership:** an explicit block lifecycle — `available → reserved → ordered → sold`. The
  installer demands a MySQL `LOCK TABLES` grant, which strongly implies pessimistic table
  locking around the reservation write rather than a unique constraint. **MED**
- **Holds:** the only clone in this survey with a documented hold mechanism — reservations
  that never complete payment auto-cancel after a configurable number of days.
- **What went wrong:** documented memory and crash failures once a grid exceeds roughly
  10,000 blocks on some PHP configurations, and a path-traversal CVE in `index.php` allowing
  arbitrary file read. **MED**

### the-million-pixel-wall (Next.js + Supabase + PayPal, 2025)

Closest in stack to what we are building. Minimum purchase 10 × 10. **HIGH**

- **Gap:** the documentation describes no concurrency control whatsoever — no lock, no hold,
  no idempotency key on the purchase flow. Two buyers can race for the same rectangle. The
  rendering strategy is also entirely undocumented.

### millionth-dollar-homepage (TypeScript, Dec 2025)

A protocol demo rather than a product: an AI agent buys ad space over an HTTP micropayment
protocol, images generated on the fly. `GET /canvas` returns painted pixels and there is no
documented database, implying ephemeral in-memory state. Not a design to copy. **MED**

### Blockchain variants

`PixelMap.io` (2016) is the interesting one: a 1296 × 784 grid of 3,969 tiles of 16 × 16 px,
with ownership *and payload* held in the Solidity contract — each tile is a 768-character hex
string, three hex characters per pixel. There is no off-chain database; the chain is the
schema. The cost is a 5–10 minute propagation lag before a change is visible. **HIGH**

Others surveyed (Ethereum, Solana compressed-NFT and Starknet ports, and a quadratic-voting
variant that allocates space by vote rather than by price) are hackathon-scale and none
reached a size where rendering became a problem. **MED**

## 2. The cautionary tale: Million Dollar Metropolis

A spiritual successor that reimagined the grid as a navigable isometric 3D city in WebGL.
Reported problems, from contemporary discussion: **MED**

- 6 fps on a gaming desktop at 1440p, with all CPU cores pinned.
- Zoom that fought the user and kept snapping back.
- WebGL defeats screen readers and native browser zoom — a straight accessibility regression
  against the original's flat HTML.
- It lost the original's core property: **the whole grid fitted on one screen**. Finding
  anything now required panning and rotating.

This is the clearest "do not do this" data point in the survey, and it is why `dollar-pixels`
keeps a flat 2D canvas that fits on one screen at 1:1. See `DECISIONS.md` D1 and D7.

## 3. r/place — the best-documented large-canvas architecture

1,000,000 cells, 1.1M unique users, 150k concurrent, 16.5M placements over 72 hours. **HIGH**

- Palette cut to 16 colours, so **4 bits per pixel — the entire million-cell canvas is about
  500 KB**. The "this is too much data" fear is unfounded at this scale.
- Storage started on Cassandra and moved to Redis: bulk-reading the whole canvas was **10 ms
  in Redis versus 30+ seconds in Cassandra**. Writes use `BITFIELD` for atomic multi-field
  updates.
- **Clients are not handed raw pixel data to draw.** A separate image-generation service
  periodically renders full PNG snapshots from canvas state, and *that image* is what gets
  cached and served.
- CDN caching with a **1-second TTL** was the primary read path and kept origin reads to
  roughly 1/sec regardless of client count. Load testing showed one extra read per second
  cost about 2,000 writes/sec of Redis capacity.
- Conflicting writes resolve **last-write-wins**; the real throttle is a per-user cooldown,
  not database arbitration.

### Pxls (Java, 260 stars) — the most complete open-source reference

PostgreSQL holds accounts and metadata, but **the canvas itself is a flat `board.dat` file**
snapshotted every five minutes. The hot, high-churn pixel array is deliberately kept out of
the relational database. Its moderation tools operate on rectangular regions, which is the
same addressing model a block marketplace needs. **HIGH**

`art98` is worth one line: it fetches the full canvas once on load and then applies only
incremental diffs over a websocket, rather than re-fetching state on every change. **MED**

## 4. How ownership gets modelled — four shapes, one conclusion

| Model | Seen in | Trade-off |
|---|---|---|
| Per-pixel bitfield / blob | r/place (~500 KB for 1M cells) | Compact, O(1) atomic write, but needs a separate compositing step before a human can look at it |
| Per-purchase rectangle row | MillionDollarScript's block lifecycle | Natural when buyers select multi-cell rectangles |
| Flat-file snapshot beside an RDBMS | Pxls `board.dat` | Keeps churn out of the database; database holds only accounts |
| On-chain mapping | PixelMap.io | Trustless, but propagation lag and gas cost |

**The conclusion that matters:** no surveyed implementation stores one row per individual
pixel for a *marketplace* grid. That pattern appears only in free-paint canvases where every
cell is individually mutable by anyone. For a sold, owned grid, every real implementation
collapses to rectangle-level or whole-canvas-blob storage. **HIGH**

## 5. Reservation and race conditions — the weakest area in every clone

Only MillionDollarScript documents a hold mechanism at all. Every other pixel marketplace
surveyed either documents no concurrency control or is silent on it. There is no good
pixel-specific reference implementation to copy, so the pattern below comes from general
reservation-system engineering rather than from any clone: **MED**

- A hold row with a **TTL** and an **idempotency key** on the checkout attempt, so a client
  retry does not double-reserve.
- Either a database unique constraint on the target cell that throws on conflict, or a Redis
  `SETNX`-style claim.
- Expired holds released not by a background sweeper but by **filtering them out at read
  time** — an unexpired hold is just a row whose `expires_at` is in the future.

That last point is the useful one: it removes an entire moving part. `dollar-pixels` uses it.
See `DECISIONS.md` D9.

## 6. Rendering 100,000+ clickable cells

### What does not work

**One DOM node per cell.** Multiple independent sources converge on roughly **5,000 DOM
nodes** as where browsers begin to visibly lag. **MED** The extreme counter-example proves
the rule: the self-described "most performant DOM-based grid" needs a `SharedArrayBuffer`
plus a web worker for off-thread ordering, custom virtualisation that works around the
browser's ~15,000,000 px element-height ceiling, DOM node pooling that never allocates on
scroll, and its own frame-priority event loop — and even then it is a *scrolling list*, not a
fully-visible grid. **HIGH**

At our size — 160,000 blocks — a DOM-per-cell grid is not slow, it is impossible.

### What works

1. **A single `<canvas>` with coordinate-math hit-testing.** No DOM elements at all. For a
   *regular* grid, hit-testing is O(1) arithmetic: take `getBoundingClientRect()`, correct
   for device pixel ratio and zoom, then integer-divide by the block size to get
   `(blockX, blockY)`. No iteration, no spatial index — the regularity of the grid is what
   buys this. A benchmark cited ~100,000 points rendered in ~287 ms in Chrome. **HIGH**
2. **The offscreen hit-canvas trick** — paint a second, invisible canvas where each region
   gets a unique flat colour, then read back the single pixel under the cursor. Necessary for
   irregular shapes; **overkill for an axis-aligned block grid**, where the arithmetic in (1)
   is exact. **HIGH**
3. **Server-composited image plus client coordinate math** — what both r/place and
   MillionDollarScript actually do in production. The browser displays one image and does
   arithmetic against a separately-fetched rectangle list. Simplest correct approach for a
   mostly-static, purchase-driven grid. **HIGH**
4. **Virtualisation** — only needed once the grid is pannable beyond one screen. Not needed
   if, as in the original, the whole grid fits on one screen. **HIGH**

### The number that closes the argument

r/place's entire 1,000,000-cell canvas is ~500 KB as a packed bitfield. A marketplace grid
backed by per-purchase rectangles is orders of magnitude smaller again, because purchases
number in the thousands, not the millions. Payload size is not a constraint here; **render
strategy is**.

## Citations

- `https://github.com/fiblan/MillionDollarScript`
- `https://github.com/mapforevercom/the-million-pixel-wall`
- `https://github.com/argotdev/millionth-dollar-homepage`
- `https://github.com/Pixel-Map/pixelmap.io`
- `https://github.com/privacy-ethereum/qdh`
- `https://github.com/pxlsspace/Pxls`
- `https://github.com/gabrielpetersson/fast-grid`
- `https://www.fastly.com/blog/reddit-on-building-scaling-rplace`
- `https://saikumarchintada.medium.com/engineering-behind-r-place-a7eb53bcf5f1`
- `https://news.ycombinator.com/item?id=22859649` (Million Dollar Metropolis discussion)
