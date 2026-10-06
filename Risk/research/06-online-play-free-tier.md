# Online multiplayer on a free tier — what the platform allows, what it costs, and what to build

Online-play research lane, 2026-10-05. Target: a browser replica of *RISK: Global Domination*
as a Next.js 16 app in `Risk/`, deployed on **Vercel Hobby** with **Neon Postgres free tier**,
following the sibling-replica conventions (`island-empire`, `Linear`, `ArtWall`, `super-smash`).

**The product requirement this lane serves.** Anyone who opens the site picks a display name —
that *is* the account. No password, no email. They then appear in an online-players list, can
create or join a lobby, and play turn-based Risk against other visitors. Solo-vs-bots and
pass-and-play are fully client-side and are not this lane's problem.

---

## 0. Recommendation first

**Build Option A: a server-authoritative engine behind Next.js route handlers, with an
append-only action log in Postgres and one adaptive short-poll per client.** Specifically:

1. The pure engine (`apply(state, action)`) runs **on the server** for every move. The client runs
   the identical function locally for prediction and for replay, never for authority.
2. One `GET /api/games/:id?since=<seq>` per client every **2 s on your turn / 4 s off your turn /
   15 s when the tab is hidden**. That single request is *also* the presence heartbeat, *also* the
   chat fetch, and *also* the trigger that runs bot turns and expired turn timers. **One
   invocation per client per tick, for everything.**
3. Dice are rolled by the server and written into the action payload. The engine contains no
   randomness at all, so client and server replay the same log to the same state, bit for bit.
4. Identity is a server-set `httpOnly` cookie minted by `POST /api/session` when you claim a name;
   the browser holds no secret in JavaScript.
5. No cron. Every periodic duty (bot turns, auto-skip, presence expiry, reaping) is done *lazily*,
   inside whichever poll happens to arrive next. Hobby cron can only fire **once per day**
   ([Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)), so a design that
   needed cron would not fit anyway.

**Why not the others, in one line each.**

- **B (SSE streaming)** makes the invocation count look wonderful and makes the three *tighter*
  budget lines — Active CPU (4 h/mo), Provisioned Memory (360 GB-hr/mo), Neon CU-hours
  (100/mo) — worse and much harder to predict. Keep the transport behind a port and adopt it
  later if the invocation line is ever the thing that binds. It is not the thing that binds.
- **C (Supabase Realtime)** is the best *engineering* answer for push and the worst fit for this
  project's constraints: it adds a second account and a second free tier to stay inside, and a
  free Supabase project **pauses after a week of inactivity** — which for a portfolio replica that
  someone opens once a month means the link is dead when it matters most.
- **D (Trystero P2P, host-authoritative)** is the sibling `super-smash`'s answer and is right
  *there* — 60 Hz rollback, no server, no accounts. It is wrong here: the authoritative state
  lives in one visitor's tab, so the host closing the tab ends the game for everyone, and a
  refresh is indistinguishable from a quit. A turn-based game whose turns last minutes needs the
  state to outlive a browser tab, and Postgres is exactly the thing that does that.

There is a fifth option the brief did not name, and it is the only one that beats A without giving
anything up: **a Cloudflare Durable Object as a pure notification bus** (§4.4b) — it pushes
`{gameId, seq}` over a WebSocket and the client still fetches the delta from the Vercel route, so
the authority never moves. It costs a second `wrangler deploy`. Build the `Sync` port so it is an
adapter, and take it only if the 2-second delay ever actually bothers someone.

**The numbers that decide it** (derivations in §4):

| Budget line | Hobby/Free allowance | Option A consumes | Headroom |
|---|---|---|---|
| Vercel Function Invocations | 1,000,000 / mo | ~900 / player-hour (adaptive) | **~1,100 player-hours/mo** |
| Vercel Active CPU | 4 hours / mo | ~10 ms / poll | ~1.4 M polls — co-binding with invocations |
| Vercel Fast Data Transfer | 100 GB / mo | ~1.5 KB / poll | ~66 M polls — never binds |
| Neon compute | 100 CU-hours / mo = 400 h awake at 0.25 CU | awake only while someone polls | ~13 h/day, every day |
| Neon storage | 1 GB / project | ~250 B / action row | ~1 M actions ≈ 2,000 full games |
| Neon egress | 5 GB / project / mo | ~2 KB / poll | ~2.5 M polls |

Twenty players online *simultaneously, around the clock,* does not fit — that is 14,600
player-hours a month and roughly 21× the invocation allowance. Twenty players online for an hour
a day fits with room to spare. That is the honest shape of the free tier, and it is the right
shape for a personal project.

---

## 1. Vercel Hobby in 2026 — what actually changed

The folklore about Vercel ("10-second functions, no WebSockets, no streaming") is **two years out
of date**. Three things moved, and all three matter here.

### 1.1 Function duration: 10 s → 300 s on Hobby

Fluid compute has been **enabled by default for new projects since 23 April 2025**
([Fluid compute](https://vercel.com/docs/fluid-compute)). With it enabled, the Node.js duration
table is:

| | Default | Maximum | Extended maximum |
|---|---|---|---|
| **Hobby** | **300 s (5 minutes)** | **300 s (5 minutes)** | — |
| Pro | 300 s | 800 s | 1800 s (beta) |
| Enterprise | 300 s | 800 s | 1800 s (beta) |

— [Vercel Functions Limits § Max duration](https://vercel.com/docs/functions/limitations#max-duration).

The old table still appears on the same page and is explicitly scoped to "an existing project,
deployed to Vercel before April 23rd 2025 and **not using Fluid compute**", where Hobby was
10 s default / 60 s max ([Vercel Limits](https://vercel.com/docs/limits)). A fresh project in
`Risk/` gets the 300 s numbers. **Do not design around 10 seconds.**

Max duration "includes time spent processing the request and sending the response, **including
streamed responses**" — so a five-minute SSE stream is a legal, supported shape on Hobby.

### 1.2 WebSockets: supported, in public beta, on all plans

> "Vercel Functions serve WebSocket connections natively, in public beta on all plans."
> — [Do Vercel Functions support WebSocket connections?](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)

Public beta since **22 June 2026** (Python support 23 July 2026). Requires Fluid compute. And then
the three caveats that make it unusable as *the* answer for this game:

- **It closes at max duration.** "Every WebSocket connection on Vercel closes when the function
  reaches its maximum duration" — 300 s on Hobby. So the client reconnects every five minutes
  regardless.
- **It pins to an instance.** "A connection stays on the function instance that accepted it for
  the connection's whole lifetime", and "a reconnecting client can land on any instance".
- **Therefore it needs a shared store anyway.** "Without a shared store, two clients in the same
  chat room can connect to different instances and never see each other's messages."

That last sentence is the whole argument. A WebSocket on Vercel is not a pub/sub bus; it is a
pinned pipe that still needs Postgres (or Redis) underneath to fan anything out between players.
You get the socket and you still write the action log. Meanwhile billing changes shape:

> "Active CPU applies only while your code processes messages, so an idle connection doesn't
> accrue CPU time. [But] Provisioned Memory bills for the lifetime of the instance, which means an
> open connection keeps its instance's memory billable until the connection closes."

### 1.3 Vercel's own guidance says "poll until a poll is not fast enough"

Vercel's realtime guide ([Publish and subscribe to realtime data on
Vercel](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel)) ends on
exactly the sentence this lane needed:

> "Polling skips the open connection and the coordination primitive underneath it. Reach for a
> push transport once the delay between an event and the client seeing it has to beat a poll
> interval."

For a game where a turn is *tens of seconds* and the perceptible unit is "did the other player
move yet", a 2-second poll does not need beating. It is also what the sibling `ArtWall` does for a
*live collaborative drawing surface*, which is a far more demanding case
(`ArtWall/components/wall/art-wall.tsx:254` — `setInterval(..., 2500)`), and it is good enough
there.

### 1.4 The Hobby allowances, verbatim

From [Fair Use Guidelines § Typical monthly usage
guidelines](https://vercel.com/docs/limits/fair-use-guidelines):

| Resource | Included (Hobby) |
|---|---|
| Fast Data Transfer | First **100 GB** |
| Function Invocations | First **1,000,000** |
| Fast Origin Transfer | First **10 GB** |
| **Active CPU** | **4 hours** |
| **Provisioned Memory** | **360 GB-hrs** |
| Image Optimization Transformations | 5K/month |

And the general limits ([Vercel Limits](https://vercel.com/docs/limits)): 200 projects,
**100 deployments/day**, **1 concurrent build**, 45-minute build cap, 120 s proxied-request
timeout, runtime logs retained **1 hour** on Hobby.

Function shape ([Functions Limits](https://vercel.com/docs/functions/limitations)): Hobby memory
**2 GB / 1 vCPU** fixed (Pro can raise it; Hobby cannot), bundle 250 MB uncompressed,
request/response body **4.5 MB**, single region by default (`iad1`), auto-scales to 30,000
concurrency, **1,024 file descriptors shared across concurrent executions**.

Two of these have teeth for this project:

- **4 hours of Active CPU per month.** Active CPU is "the amount of CPU time your code actively
  consumes… Waiting for I/O (e.g. calling AI models, database queries) does not count"
  ([Functions Limits § Cost and usage](https://vercel.com/docs/functions/limitations#cost-and-usage)).
  A poll handler that waits on Neon is almost all I/O — but JSON-serialising a 100-territory game
  state is *not* I/O. **This is the reason the poll must return a delta, not a snapshot** (§4.1).
- **2 GB / 1 vCPU, not configurable.** Provisioned Memory bills instance-lifetime × memory, so any
  long-lived connection on Hobby bills at 2 GB. 360 GB-hr ÷ 2 GB = **180 instance-hours/month**
  of long-lived connection, *shared* across however many streams Fluid's in-function concurrency
  packs onto one instance — a number you cannot configure and cannot easily measure in advance.
  That uncertainty is the real argument against Option B.

### 1.5 Cron is once per day on Hobby

| | Cron jobs per project | Minimum interval | Precision |
|---|---|---|---|
| **Hobby** | 100 | **Once per day** | Per-hour (±59 min) |
| Pro | 100 | Once per minute | Per-minute |

> "Hobby accounts are limited to cron jobs that run **once per day**. Cron expressions that would
> run more frequently will fail during deployment."
> — [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)

A daily cron cannot run a bot's turn, cannot expire presence, and cannot enforce a 60-second turn
timer. **Every periodic duty in this design is therefore lazy** — performed by whichever request
happens to arrive next. This is not a workaround; it is strictly better, because the work only
happens when someone is there to see the result. A daily cron is still worth one entry for a
belt-and-braces garbage sweep (§4.6).

### 1.6 Streaming / SSE is viable, and for how long

Streaming is enabled by default for all Node.js functions and a Next.js App Router route handler
can return a `ReadableStream` with `Content-Type: text/event-stream`
([Streaming](https://vercel.com/docs/functions/streaming-functions)). The ceiling is the function
max duration — **300 s on Hobby** — because that duration "includes time spent… sending the
response, including streamed responses". On the **Edge** runtime the rule is different and worth
recording: a function "must begin sending a response within 25 seconds to maintain streaming
capabilities beyond this period, and can continue streaming data for up to 300 seconds"
([Max duration § Edge runtime](https://vercel.com/docs/functions/limitations#max-duration)).

So: a five-minute SSE window, then the browser's own `EventSource` auto-reconnect, then another
five minutes. `EventSource` reconnects by itself and replays `Last-Event-ID`, which maps onto the
`seq` protocol in §5 with no extra work. The reason not to take this now is cost shape, not
capability — see §4.3.

**The Edge runtime is the wrong runtime here** regardless: the Neon driver in `island-empire` is
loaded through a variable dynamic import and the project's `next.config.ts` has to
`outputFileTracingIncludes` it into the Node function. Keep route handlers on Node.js.

---

## 2. Neon free tier, and the realtime alternatives

### 2.1 Neon Free plan, 2026

From [Neon Plans](https://neon.com/docs/introduction/plans):

| | Free plan |
|---|---|
| Storage | **1 GB/project**, 20 GB account total (enforced independently) |
| Compute | **100 CU-hours/project/month** — "enough to run a 0.25 CU compute… for 400 hours/month" |
| Projects | 100, with 10 branches per project |
| Scale-to-zero | **after 5 min** idle; "For Neon Free plan users, this setting is fixed" — **cannot be disabled** |
| Data transfer | **5 GB per project** egress included |

A **Compute Unit** is ~4 GB RAM plus associated CPU and local SSD, and the billing formula is
literally `compute size × hours running = CU-hours`, metered on **wall-clock time the compute is
running**, not on query count ([Usage metrics](https://neon.com/docs/introduction/usage-metrics)).
Their own worked example: `0.25 CU for 4 hours = 1 CU-hour`.

**The consequence for a polling design, stated plainly.** Compute-hours are charged for *being
awake*, and a 2-second poll keeps the compute awake continuously. So:

- 100 CU-h ÷ 0.25 CU = **400 awake-hours per month = 13.3 hours per day, every day.**
- A single browser tab left polling forever keeps it awake 730 h/month = **182.5 CU-hours**, i.e.
  1.8× the allowance, exhausted around day 17 of the month.

That single fact produces a **hard design requirement**: the client must stop polling when the tab
is hidden for more than a couple of minutes, when the game is over, and when the user is idle on a
non-game screen. Not an optimisation — the difference between a free database and a dead one. The
precedent is already in `ArtWall`, which hooks `visibilitychange` and refetches on *becoming*
visible (`art-wall.tsx:264`); this project needs the inverse too — *stop* on becoming hidden.

### 2.2 Autosuspend latency and the 2-second loop

Neon "reactivates automatically within a few hundred milliseconds" on the next query
([Scale to zero](https://neon.com/docs/introduction/scale-to-zero)). Practically:

- **During play it never suspends.** A poll every 2–4 s is far inside the 5-minute idle window, so
  the compute is warm for the whole session and the cold start is paid once.
- **The cold start lands on the first person through the door.** Opening the lobby after a quiet
  night costs a few hundred ms on that one request. The fix is a UI fix, not an infra fix: render
  the lobby shell immediately and fill the online-players list when it arrives.
- **It never lands mid-game.** Which is the thing that would have been unacceptable.

### 2.3 `@neondatabase/serverless`: HTTP vs WebSocket

Neon's guidance: "Use the driver over HTTP by default" — the `neon()` function over `fetch` is
"the fastest option for single queries and for multiple queries in one non-interactive
transaction". Switch to the WebSocket-backed `Pool`/`Client` "only if you need interactive
transactions, sessions, or compatibility with node-postgres"
([Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)).

`island-empire` already encodes exactly this split, and it is **directly reusable**
(`island-empire/src/adapters/db/neon.ts`):

```ts
// Single statements go over HTTP, which costs one round trip instead of
// a WebSocket handshake. `connect()` still upgrades to a socket, which
// is what transactions need.
neon.neonConfig.poolQueryViaFetch = true;
```

For this game that maps cleanly onto the two request shapes:

- **The poll** (`GET /api/games/:id`) is 1–3 single statements → HTTP fast path. No handshake.
- **The action append** (`POST .../actions`) must be one real transaction (allocate `seq`, insert
  the action, update the snapshot, all atomic) → `db.transaction()`, which opens a WebSocket
  client. One handshake on a request that happens a few times a minute, not a few times a second.

That is the right place for the cost, and it is the reason the adapter needs *both* modes.

### 2.4 Neon has no usable realtime push — confirmed

- `LISTEN`/`NOTIFY` **does not work on the pooled endpoint**, because Neon's pooler is PgBouncer
  in transaction mode. It needs a direct connection and a held session. And "by default, a Neon
  compute scales to zero after 5 minutes of inactivity, and NOTIFY and LISTEN only persist for the
  duration of the current session and are lost when the session ends"
  ([Neon: real-time backends FAQ](https://neon.com/faqs/best-backend-real-time-chat-presence-live-updates),
  [pg_notify guide](https://neon.com/guides/pg-notify)).
- A Vercel function cannot hold that session anyway — it dies at 300 s.
- Neon's own recommendation for realtime is to **pair Postgres with a separate pub/sub service**
  ("you can pair it with a publish-subscribe service like Ably LiveSync"), or to use Neon
  Functions, which are not a Vercel-hosted thing.
- Logical replication is for replicating *to* another database, not for pushing to a browser.

**Conclusion: with Neon, the fan-out mechanism is the client's poll. There is no second option
inside Neon itself.** This is settled, not a judgement call.

### 2.5 Alternatives on free tiers

Eight candidates, one paragraph each. The columns that decide it: **free-tier ceiling · does a
secret go in the browser · turn-based reliability · what happens when the host tab closes · the
gotcha.**

| | Free ceiling | Secret in browser? | Host tab closes | The gotcha |
|---|---|---|---|---|
| **Supabase Realtime** | 200 peak connections, 2 M msgs/mo, 500 MB DB | `anon`/`sb_publishable_*` key — **by design** | no host; state in Postgres | **project pauses after 1 week idle** |
| **Upstash Redis** | 500 K commands/mo, 256 MB, 10 GB bandwidth | read-only token by design; **PUBLISH needs a write token** | no host; state in Redis | pub/sub only via a raw SSE endpoint |
| **Ably** | 6 M msgs/mo, 200 connections, 200 channels | must **not** ship the key — needs a token endpoint | no host | not backendless; 1-day history only |
| **Pusher Channels** | 200 K msgs/day, **100 connections** | app key public, secret server-side | no host | no persistence at all; late joiners get nothing |
| **PartyKit (hosted)** | unverifiable | — | — | **hosted deploys broken since 2026-06-18** |
| **Cloudflare Workers + DO** | 100 K req/day, 13 K GB-s/day, 5 GB SQLite | **none** | the DO *is* the host; survives | splits the deployment across two platforms |
| **Firebase RTDB (Spark)** | **100 simultaneous connections**, 1 GB, 10 GB/mo down | API key — by design | no host; `onDisconnect()` | 100-connection hard ceiling; rules footguns |
| **Trystero / PeerJS** | free, no quota | none (Nostr/MQTT/BT) | **game over** | no persistence; needs your own TURN |

**Supabase Realtime.** The free Realtime quota is **200 concurrent peak connections and 2 million
messages per month**, on a 500 MB database with 5 GB egress and 50,000 MAU
([pricing](https://supabase.com/pricing),
[realtime messages](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)).
Per-connection runtime quotas on Free: 100 messages/sec, 100 channel joins/sec, 100 channels per
connection, 256 KB max broadcast payload, 10 presence keys per object
([quotas](https://supabase.com/docs/guides/realtime/quotas)). Message accounting matters for the
estimate: a Postgres-Changes event counts **one message per listening client**, and a Broadcast
counts **1 for the send plus 1 per subscribed client** — so one move in a 5-player game is ~6
messages, and 2 M/month is wildly ample. The `anon` key (being renamed to `sb_publishable_*`, with
the legacy `eyJ…` JWTs deprecated by end of 2026) is explicitly "safe to expose… web page, mobile
or desktop app, GitHub actions, CLIs, source code"
([API keys](https://supabase.com/docs/guides/api/api-keys)) — **RLS** is the security boundary, not
key secrecy. Private channels need `config: { private: true }` plus RLS policies on
`realtime.messages`, and "Allow public access" turned off in Realtime Settings
([authorization](https://supabase.com/docs/guides/realtime/authorization)). "Broadcast from
Database" (`realtime.send()` / `realtime.broadcast_changes()`) writes into a daily-partitioned
`realtime.messages` whose rows drop after 72 h, and carries a sharp edge: "A client connecting over
WebSocket creates those daily partitions. `realtime.send` does not"
([broadcast](https://supabase.com/docs/guides/realtime/broadcast)) — DB-side broadcasts can fail on
a day when no client has connected yet. Reliability for turn-based play is good and the host-tab
question does not arise: there is no host, and presence members simply drop out. **The
disqualifier is the pause:** "Free projects are paused after 1 week of inactivity. Limit of 2
active projects" ([free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)),
where inactivity is measured on *database* activity — so a Broadcast-only design could keep
Realtime busy and still be paused. A portfolio replica's entire traffic pattern is week-long
silences punctuated by one visitor, which is precisely the pattern that trips this.

**Upstash Redis.** Free: **500 K commands/month, 256 MB max data size, 10 GB bandwidth/month**,
10 MB max request size ([pricing](https://upstash.com/pricing/redis)). Concurrent connections were
raised from 1 K to a **10 K soft limit across all plans including Free**
([limits increase](https://upstash.com/blog/limits-increase)), though the per-plan figure is not
restated in the current pricing table and the troubleshooting page documents only the error
`ERR max concurrent connections exceeded` without a number — treat it as a soft limit with
idle eviction. There *is* a realtime path: "Upstash REST API provides Redis `SUBSCRIBE` and
`PUBLISH` commands. The `SUBSCRIBE` endpoint works using Server Send Events mechanism"
([REST API](https://upstash.com/docs/redis/features/restapi)) — but blocking commands
(`BLPOP`, blocking `XREAD`), `WATCH`/`MULTI` semantics and cluster commands are unsupported, and
SSE-subscribe is a raw-endpoint feature rather than something `@upstash/redis` exposes typed. The
browser story is half-good: Upstash ships a **read-only token** explicitly "when you access Upstash
Redis from web and mobile clients where the token is exposed to public", but **`PUBLISH` is a
write**, so a browser that publishes needs a write token — and a write token in a public bundle
means any visitor can overwrite or flush the game. Proxying it through a function restores safety
and removes the entire reason to use it. 500 K commands/month is also *half* the Vercel invocation
budget, so Upstash would bind before Vercel did. Good state store, weakest realtime path here.

**Ably.** Free: **6 M messages/month, 500 messages/sec peak, 200 concurrent connections, 200
concurrent channels**, 200 presence members per channel, 64 KiB max message, 1-day message history,
unlimited subscribers per channel ([pricing](https://ably.com/pricing)). This is the most robust
realtime of the group — connection recovery, guaranteed ordering, and history replay that makes
reconnect trivial. It is also the one Neon's own docs reach for ("pair it with a publish-subscribe
service like Ably LiveSync"). The cost is that an Ably API key carries full capabilities and must
not be shipped to a browser; the documented pattern is token auth from a server endpoint — so it is
**not backendless**, and if you are writing the server endpoint anyway you already have the route
handler that Option A is built from. *(The key/token-auth point was not re-fetched from Ably's
docs in this pass; it is design knowledge, flagged as such.)*

**Pusher Channels (Sandbox).** Free: **200 K messages/day, 100 max concurrent connections**
([pricing](https://pusher.com/channels/pricing/)). The app key is public by design and the secret
stays server-side; client-triggered events on private or presence channels need a signing endpoint,
so a purely static game is limited to public channels. The real disqualifier is that Channels is
fire-and-forget with **no persistence whatsoever** — a player who joins late or reloads gets
nothing, so you need a separate store, so you are back to Postgres plus a second service.

**PartyKit — do not choose it in 2026.** Acquired by Cloudflare in April 2024; the
[`partykit/partykit`](https://github.com/partykit/partykit) README now redirects development to
[`cloudflare/partykit`](https://github.com/cloudflare/partykit), whose README says only "Much like
life, this is a Work in Progress." The hosted platform is **broken for new deployments**: open
issue [#985](https://github.com/partykit/partykit/issues/985) (18 June 2026) reports
`You have exceeded the limit of 10000 Workers custom domains on zone 'partykit.dev'` — the shared
hosted zone is exhausted, with no maintainer resolution. No official sunset notice exists and no
hosted free-tier numbers could be verified. The live descendant is Cloudflare Workers + Durable
Objects (or `partyserver`) in your own account.

**Cloudflare Workers + Durable Objects — the strongest *push* architecture, and it splits the
deploy.** Durable Objects **are** available on the Workers Free plan, but "Only Durable Objects
with SQLite storage backend are available" (the KV backend needs Workers Paid)
([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Free daily
limits: **100,000 requests/day, 13,000 GB-s/day of compute, 5 M SQLite rows read/day, 100,000 rows
written/day, 5 GB SQLite stored**, resetting at 00:00 UTC; Workers Free adds 100,000 requests/day
and **10 ms CPU per request**
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). The killer feature
for a turn-based game is **WebSocket Hibernation**: "Billable Duration (GB-s) charges do not accrue
during hibernation" — the object is evicted from memory while clients stay connected at the edge
and is revived on the next message
([WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)). So an
idle lobby costs nothing, sub-second push is free, **no secret goes in the browser at all** (the
client just opens a WSS to your Worker), and the DO *is* the host — it survives every tab closing.
Best security posture and best cost shape of any push option.

Why it is nevertheless not the recommendation: the DO would become the authority, which means the
engine runs in a Cloudflare Worker while the UI deploys to Vercel — **two platforms, two deploy
commands, two runtimes, and the pure engine imported into both.** That breaks the repo's one-folder-
one-Vercel-project convention and roughly doubles the deployment surface for latency the game does
not need. *(The docs do not state a max concurrent WebSockets per DO, nor explicitly confirm
Hibernation on the free plan — it is a DO feature and DO is free-plan-eligible, so it should apply,
but that is inference, not a citation.)* If this project ever wants true push, **this is the
option to take, and the cheapest version is to let the DO be only a notification bus** — it
broadcasts `{gameId, seq}` and clients fetch the delta from the existing Vercel route, so the
authority stays in one place and the Worker holds no game logic. That is a ~100-line Worker behind
the same `Sync` port.

**Firebase Realtime Database (Spark).** Free: **100 simultaneous connections, 1 GB stored, 10 GB
downloaded per month** ([pricing](https://firebase.google.com/pricing)). The API key in the browser
is explicitly fine — "API keys restricted to Firebase services do not need to be treated as
secrets", with security "enforced using Firebase Security Rules… and App Check"
([API keys](https://firebase.google.com/docs/projects/api-keys)). Reliability for turn-based play is
very good (long-lived socket, offline queueing), and `onDisconnect()` is the idiomatic way to free a
seat when a tab closes — genuinely the nicest primitive for the "player left" problem in this whole
list. No documented inactivity pause. Against it: **100 simultaneous connections is a hard
ceiling**, the default rules are either deny-all or time-bombed test rules (the classic
world-writable Firebase leak), and it adds a Google project plus the `firebase` SDK to a repo whose
every sibling is Postgres. Second-best of the hosted options, and a long way behind Option A on
"how many things must I keep alive".

**Trystero / PeerJS (WebRTC P2P).** **Trystero 0.26.0, published 2026-10-04** — very actively
maintained ([npm](https://registry.npmjs.org/trystero/latest)). Seven signalling strategies —
BitTorrent, Nostr, MQTT, Supabase, Firebase, IPFS and a self-hosted WebSocket relay — scoped as
`@trystero-p2p/<strategy>` since v0.23.0. **The default is Nostr, not BitTorrent:** "By default
Trystero uses the Nostr network which is highly decentralized with hundreds of active relays
running… The other decentralized strategies are recommended in the order of MQTT, BitTorrent, and
IPFS, based on robustness. These networks have far less relay redundancy than Nostr."
([README](https://github.com/dmotz/trystero)). So the answer to "is BitTorrent still reliable in
2026" is: it is no longer the default and ranks *third* for robustness. v0.26.0 hardened Nostr
specifically — updated default relays, better subscription retries, discovery recovery after relay
reconnects, rate-limit backoff for failing relays. BitTorrent, Nostr, MQTT, IPFS and the WS-relay
strategy need **no credentials at all**; only the Supabase strategy (anon key) and Firebase
strategy (`databaseURL`) do. **NAT is the real-world failure:** public STUN by default, and relayed
traffic needs your own `turnConfig` — the README points at Cloudflare TURN (1,000 GB/month free) or
Open Relay, or self-hosted coturn/Pion. Without TURN, symmetric-NAT and corporate-firewall players
simply cannot connect. Max peers per room is **not documented**; full-mesh WebRTC is O(n²), fine
for ≤6–8 and poor beyond. And the structural problem: **there is no server copy of the game**, so
whichever tab holds the authoritative state takes it with them. **PeerJS's public cloud has
essentially no published limits** — the FAQ says only that it "handles signaling for free" and that
"PeerServer may hold a connection offer for up to 5 seconds before rejecting it"; the widely-cited
`Server has reached its concurrent user limit` traces to `peerjs-server`'s **self-hosted** default
of 5000, and [issue #997](https://github.com/peers/peerjs/issues/997) asking for the cloud's real
limits has been unanswered since 2022. No TURN on the public cloud.

**What the comparison establishes.** Every option that gives sub-second push either (a) puts a key
in the browser and adds a service that pauses or caps connections, (b) adds a second deployment
platform, or (c) gives up durable state. Option A gives up sub-second latency — the one thing a
turn-based game does not need — and gives up nothing else.

---

## 3. The local precedents — what is directly reusable

Four sibling projects have already solved pieces of this. Almost nothing here needs inventing.

### 3.1 `island-empire` — the persistence pattern, reusable essentially verbatim

The newest and best reference (`island-empire/src/adapters/db/`). Five files:

| File | What it is |
|---|---|
| `driver.ts` | `SqlValue` / `SqlRow` / `SqlExecutor` / `SqlDatabase` interfaces, plus a hand-rolled `splitStatements()` that respects string literals, `$tag$` blocks and comments |
| `pglite.ts` | Local + default adapter. Postgres compiled to WASM. Dynamic import through a *variable* specifier so no bundler follows it. `AsyncLocalStorage` nesting guard + a promise queue, because PGlite is single-writer |
| `neon.ts` | Deployed adapter. `poolQueryViaFetch = true`; falls back to importing `ws` for the WebSocket constructor; `transaction()` opens a real `pool.connect()` client and binds an executor to it |
| `index.ts` | `getDb()` — the composition point |
| `schema.sql` | The single source of truth, idempotent, applied by `db:push` |

Three decisions in there are load-bearing and must be copied, not re-derived:

**(a) PGlite locally, not SQLite.** The rationale is in `driver.ts`:

> "SQLite's default `BINARY` collation is byte-wise; Postgres' default ICU collation folds case…
> PGlite is Postgres compiled to WASM — the same parser, planner and collation."

For this project the stakes are higher than collation: the whole e2e story in §6 depends on the
local database behaving like the deployed one under *concurrent* writes from two browser contexts.

**(b) The handle is memoised on `globalThis`, not in a module-level `let`.**

> "Next builds several module graphs per app — server components, route handlers, server actions —
> and evaluates them separately, so a module-scoped singleton is a singleton *per graph*, not per
> process. With PGlite that means several WASM Postgres instances against one data directory,
> which is how you corrupt its WAL."

`const REGISTRY = Symbol.for("island-empire.db")` → `Symbol.for("risk.db")`.

**(c) The production guard** (`island-empire/src/config/env.ts`). `DATABASE_URL`'s presence selects
the driver; `DB_DRIVER` can force it; an unknown value **throws rather than falling back**; and:

```ts
if (isProduction && driver === "pglite" && !allowsPgliteUnderProduction()) throw new Error(
  "DB_DRIVER=pglite cannot be used in production: its storage does not survive a serverless " +
  "invocation. Set DATABASE_URL to a Postgres connection string.");
```

`allowsPgliteUnderProduction()` requires `E2E_ALLOW_PGLITE_PRODUCTION_BUILD=true` **and**
`!isServerless()`, where `isServerless()` checks a list of markers (`VERCEL`,
`AWS_LAMBDA_FUNCTION_NAME`, `NETLIFY`, `RENDER`, `FLY_APP_NAME`, `K_SERVICE`, `CF_PAGES`, …) so the
escape hatch cannot fire on a real deployment even if the variable leaks there. For an *online*
game this guard is more important than it was for island-empire, where the database only held
shareable maps: here, silently falling back to per-instance PGlite would mean every player talking
to a different, empty game.

**(d) `db:push` runs in the Vercel build, not on first request.** `island-empire/vercel.json` is
one line:

```json
{ "buildCommand": "pnpm run db:push && pnpm run build" }
```

> "Hobby builds one deployment at a time, which makes this race-free, while a function that
> migrates on cold start migrates once per instance from however many happen to be warming."
> — `island-empire/scripts/db-push.ts`

Two gotchas recorded in that script that this project will hit identically: `node
--experimental-strip-types` rejects TypeScript **parameter properties**
(`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), and `import "server-only"` throws in a plain Node process —
so the push script talks to the drivers directly and reads `schema.sql` off disk rather than
importing the adapters. Also note `prebuild: node scripts/build-schema.mjs`, which generates
`schema.ts` from `schema.sql` because reading the `.sql` at runtime does not survive Vercel
bundling, plus a `schema.test.ts` drift guard that fails the build if the committed output
disagrees.

### 3.2 `ArtWall` — the actual, shipped, Neon-plus-polling precedent

This is the closest living analogue: a **shared live surface on Neon, synced by polling**, which
is the same problem shape minus the turn structure.

- **Poll interval: 2,500 ms**, plus an immediate refetch on `visibilitychange → visible`
  (`components/wall/art-wall.tsx:254`).
- **The API is three routes**: `GET /api/wall` (merged read), `POST /api/wall/strokes`,
  `POST /api/wall/texts`, plus `/api/health`. `export const dynamic = "force-dynamic"` and
  `Cache-Control: no-store` on the read.
- **The read is cursor-paged, not full-state**: `listStrokeRows(wallId, limit, cursor)` with
  `where created_at < $cursor::timestamptz order by created_at desc limit $n`
  (`lib/db/server.ts`). This is the `?since=` idea in a weaker form — it uses a timestamp cursor
  where this project will use a monotonic `seq`, which is strictly better (no clock, no ties).
- **Optimistic local application** with a `local-stroke-${crypto.randomUUID()}` optimistic id and a
  JSON "stroke signature" to dedupe the echo when the poll returns the server's own copy. This
  project replaces that heuristic with a proper `client_action_id` (§5.3) — the signature trick is
  exactly the kind of thing that works until two players do the same thing.
- **A `client_id` column on every row**, so a client can tell its own writes from others'.
- **`serverExternalPackages: ["@neondatabase/serverless"]`** in `next.config.ts`.
- **Validation in the schema, not only in Zod**: `scripts/schema.sql` carries `check` constraints
  for colour hex, stroke width range, text length, and an `immutable` SQL function
  `stroke_points_are_normalized(jsonb)` asserting every point is a 2-element array in `[0,1]`.
  **Copy this habit.** For Risk it means `check (seat between 0 and 5)`,
  `check (status in (...))`, name-length and name-charset checks — the database refuses a
  malformed game even if a route handler forgets to.

The one thing `ArtWall` shows by omission: it has `@supabase/supabase-js` in `package.json` and a
`supabase/migrations/` directory, and `.env.example` says

> "Legacy Supabase keys (no longer used; the original project was deleted)."

and `lib/db/server.ts` says

> "The original deployment used Supabase; that project no longer exists… Realtime is polling from
> the client rather than a Supabase channel."

**A sibling project already migrated off Supabase Realtime onto Neon-plus-polling and the result
is live and works.** That is the single most relevant data point in this document, and it is local.

### 3.3 `Linear` — the env/driver pattern this inherits from

`Linear/src/config/env.ts` is the original of island-empire's `config()`: one module reads
`process.env` and nothing else in `src/` does; `oneOf()` throws on an unknown enum rather than
falling back (with a comment naming `dollar-pixels` as the project that "learned this the
expensive way"); the same `SERVERLESS_MARKERS` list; the same production guard. `Linear`'s API
surface is also the naming precedent for §4.5 — flat, plural, resource-first route handlers
(`src/app/api/issues/route.ts`, `src/app/api/issues/[id]/route.ts`,
`src/app/api/issues/reorder/route.ts`, `src/app/api/teams/[id]/members/route.ts`), with neither a
`vercel.json` nor any custom function config.

Also from `Linear`: `src/lib/boot.ts` exports `ensureReady()`, memoised on
`Symbol.for("linear-clone.ready")`, which migrates **only when `driver === "pglite"`** — because
Neon was already migrated by `db:push` during the build. Reuse that split exactly.

### 3.4 `super-smash` — the engine discipline, and an honest warning about P2P

`super-smash` is the project that *did* choose P2P, and reading it is what settles Option D.

**What to copy wholesale:**

- **`src/engine/layering.test.ts`** — a test that walks the actual engine source, strips comments
  and strings, and fails the build on any import of `render/`, `net/`, `react`, `next`, or any call
  to `Math.random`, `Date.now`, `performance.now`, `new Date`, `crypto.`, or any reference to
  `window`, `document`, `localStorage`, `fetch(`, `process.env`. The test also unit-tests its own
  guard. **For this project that test is not hygiene, it is the determinism proof** (§5) — and
  `island-empire` already carries its own copy of the idea, so there are two references.
- **`src/net/transport.ts`** — the transport *port*: `send`, `onMessage`, `onPeerJoin`,
  `onPeerLeave`, `close`, `selfId`, and deliberately nothing about connection state or ordering.
  Three adapters behind it (`webrtc`, `broadcast`, `loopback`), and `rollback.ts` imports the port
  and never an adapter. The equivalent here is a **`Sync` port** with `poll()`,
  `submit(action)`, `onActions()` — so Option A's poller, Option B's SSE and a future WebSocket are
  three adapters rather than three rewrites.
- **The debug handle** (`window.__smashDebug.fighters()`) that lets e2e read simulation truth
  instead of pixels: "pixels can only tell you something was painted… [not] whether the simulation
  moved". §6 depends on the same idea.
- **A state hash** (`src/engine/hash.ts`) used for desync detection. §5.5 adopts it.

**What it warns about.** `DECISIONS.md` D9 and D20:

> "Trystero does peer discovery over existing public infrastructure with **no signalling server at
> all**, so the whole game deploys as a static site with zero backend and zero accounts."

and the cost, stated in its own Known Gaps:

> "**No TURN server.** On the open internet, some NAT combinations will fail to connect
> peer-to-peer. Local network play — the case the design targets — is unaffected."

Read that against this project's brief. Super-smash is designed for *two laptops in one room*,
where ICE finds the LAN route and the lack of TURN costs nothing. This project's brief is *anyone
who opens the website*, which is precisely the open-internet, arbitrary-NAT case where Trystero's
one real gap lives. D20 also rejected "Vercel's native WebSockets — in beta, pinned to one
instance", which was correct then and is still the accurate description now (§1.2).

**Two documentation discrepancies found in `super-smash` while reading it** (flagged, not fixed —
different project, different lane):

1. `README.md:253` documents `NEXT_PUBLIC_SIGNAL_STRATEGY` as a configurable variable, but no file
   under `src/` references that name. The variable does not exist.
2. `README.md:253` also says the default "defaults to BitTorrent trackers", while
   `src/net/adapters/webrtc.ts` describes its default as "Trystero's Nostr-signalled `joinRoom`".
   **The code comment is the correct one:** since Trystero v0.23.0 the plain `trystero` package
   depends on `@trystero-p2p/nostr`, and the README of Trystero 0.26.0 states "By default Trystero
   uses the Nostr network" (§2.5). So `super-smash` is signalling over Nostr and its README
   describes a strategy it does not use — which matters, because Nostr is the *more* robust choice
   and the README undersells it.

### 3.5 Summary: what this project writes from scratch

| Reusable as-is | Needs writing |
|---|---|
| `adapters/db/{driver,pglite,neon,index}.ts` | `game_actions` append-with-`seq` transaction |
| `config/env.ts` + production guard + `SERVERLESS_MARKERS` | The lazy tick (bots, turn timer, reaper) |
| `scripts/{db-push.ts,build-schema.mjs}` + `vercel.json` buildCommand | Session / name-claim route |
| `next.config.ts` (`serverExternalPackages`, `outputFileTracingIncludes`, `turbopack.root`) | Presence + lobby read model |
| `engine/layering.test.ts` determinism guard | Per-seat projection (if fog is implemented) |
| `net/transport.ts`-shaped port, as a `Sync` port | The adaptive poll scheduler |
| `ArtWall`'s `check`-constraint-heavy schema style | |
| `playwright.config.ts` with pinned `DB_DRIVER` | Two-context e2e helpers |

---

## 4. The design options, evaluated

Evaluation axes, from the brief: **zero cost · zero secrets in the browser · works with Vercel's
function model · survives a refresh · allows reconnect · handles a player who leaves · cheating
resistance appropriate to a casual personal project.**

### 4.0 Scorecard

| | A. Postgres + poll | B. A, but SSE | C. Supabase Realtime | D. Trystero P2P |
|---|---|---|---|---|
| Zero cost | ✅ inside Hobby + Neon free | ⚠️ shifts load onto the two tightest lines | ✅ but a 2nd free tier to stay inside | ✅ truly $0 |
| Zero secrets in the browser | ✅ nothing but an httpOnly cookie | ✅ | ❌ anon key in the bundle (by design) | ✅ |
| Fits Vercel's function model | ✅ perfectly — short requests | ⚠️ legal, but fights the billing model | ✅ bypasses functions entirely | ✅ static site |
| Survives a refresh | ✅ state is in Postgres | ✅ | ✅ | ❌ host's tab *is* the state |
| Reconnect | ✅ `?since=seq`, trivially | ✅ `Last-Event-ID` | ✅ built in | ⚠️ needs a host handoff protocol |
| Player leaves | ✅ turn timer → auto-skip → bot takeover | ✅ same | ✅ same | ❌ host leaves = game over |
| Cheating resistance | ✅ server-authoritative | ✅ | ✅ | ❌ host sees and controls everything |
| Latency to see a move | 2–4 s | <1 s | <1 s | <100 ms |
| New accounts/services | none | none | **one** | none |
| Build complexity | low | low + 1 adapter | medium | **high** (host election, handoff) |

Plus **Option E** (§4.4b), a Cloudflare Durable Object used purely as a notification bus: it scores
✅ on every row including sub-second latency, and pays for it with a second deployment platform.
It is the right *second* implementation and the wrong first one, for the same reason as B.

### 4.1 Option A — Postgres + adaptive short polling (**recommended**)

**Shape.** Append-only action log plus a cached snapshot. Every move is a row in `game_actions`
with a monotonic `seq`. `games.snapshot` holds the state as of `games.snapshot_seq`, so a cold
client gets one row and a warm client gets only the deltas.

**The single poll.** `GET /api/games/:id?since=<seq>` does **five** jobs in one invocation:

1. Stamps `players.last_seen_at = now()` for the caller (presence heartbeat — **not a separate
   request**).
2. Runs the lazy tick: expired turn deadline → auto-skip; current seat is a bot → run the bot.
3. Returns `game_actions` where `seq > since` (the delta) — or the snapshot if `since <
   snapshot_seq`.
4. Returns the other seats' presence (who is away) and `turn_deadline`.
5. Returns `chat_messages` since the client's last chat id.

**This folding is what makes the budget work.** A design with separate presence, chat and game
polls costs 3× the invocations for no added capability.

**Adaptive interval.** Not a constant. The schedule:

| Situation | Interval |
|---|---|
| It is your turn | 2,000 ms (so your own confirmations feel instant) |
| It is someone else's turn, tab visible | 4,000 ms |
| Lobby / browse screen, tab visible | 5,000 ms |
| Tab hidden | 15,000 ms, and **stop entirely after 5 minutes hidden** |
| Game finished, or you are eliminated | stop |

Also: **re-poll immediately** on `visibilitychange → visible` (the `ArtWall` pattern), and
immediately after your own `POST .../actions` returns (so the authoritative result lands at once),
and apply jitter of ±15 % so four clients in one game do not synchronise into a thundering herd.

**Invocation arithmetic.** Invocations per player-hour `= 3600 / interval`:

| Interval | Invocations / player-hour | Player-hours inside 1,000,000 |
|---|---|---|
| 2 s | 1,800 | 556 |
| 2.5 s | 1,440 | 694 |
| 3 s | 1,200 | 833 |
| 4 s | 900 | 1,111 |
| 15 s | 240 | 4,167 |

The adaptive mix — in a 4-player game you are on your own turn ~25 % of the time — averages
`0.25 × 1800 + 0.75 × 900 ≈ 1,125` per player-hour of *active play*, and much less for lobby
loitering. Call it **~1,100 invocations per player-hour** including the POSTs, chat sends and page
loads. So:

> **Budget: roughly 900 player-hours of online play per month before the invocation line binds.**

Expressed the way the brief asked — **20 concurrent players**:

- 20 players online **24/7** = 14,600 player-hours/month → ~16 M invocations → **21× over.** Does
  not fit, and no polling interval fixes it (even 15 s flat is 3.5 M).
- 20 players online **1 hour a day, every day** = 600 player-hours → ~660 K invocations → **fits,
  with 34 % headroom.**
- 20 players online **90 minutes a day** = 900 player-hours → ~1.0 M → **exactly at the line.**

For a portfolio replica, 600 player-hours a month is already a wildly successful month. The free
tier is sized for this; it is not sized for a service.

**Active CPU is the co-binding line, and it dictates the response shape.** 4 hours = 14.4 M
CPU-milliseconds. Database waiting does not count, so the CPU in a poll is: route-handler
overhead, Zod parse of the query, and **JSON serialisation of the response**. A full 42-territory
Risk state snapshot is maybe 4–8 KB of JSON; serialising it costs real milliseconds. A delta of
zero or one action costs almost nothing.

| CPU per poll | Polls inside 4 CPU-hours |
|---|---|
| 5 ms (delta, usually empty) | 2,880,000 |
| 10 ms | 1,440,000 |
| 25 ms (full snapshot every poll) | 576,000 |

So **a delta-returning poll is CPU-co-binding with the invocation line at ~1.4 M (fine), and a
snapshot-returning poll binds first, at 576 K (not fine).** Three cheap rules follow:

1. When `seq === since`, return **`204 No Content`** with no body at all. This is the common case —
   most polls during someone else's thinking time find nothing — and it costs near-zero CPU, zero
   serialisation and ~0 bytes of transfer.
2. Return the snapshot **only** when the client is cold or has fallen behind `snapshot_seq`.
3. Serve `ETag: W/"<seq>"` and honour `If-None-Match` so the 204 path is a string compare.

**Neon arithmetic.** Compute is charged for *awake wall-clock*, so it depends on session shape,
not request count. 600 player-hours a month concentrated into, say, 150 distinct hours of
calendar time (several players overlap) plus a 5-minute suspend tail per session ≈ 170 awake-hours
→ `0.25 × 170 = 42.5 CU-hours` — **inside the 100 CU-hour allowance with 2× headroom.** The
failure mode is not volume; it is *a single abandoned tab* polling for a month (182.5 CU-h). Hence
the hard stop-when-hidden rule in §2.1.

Storage: an action row is an id, a seat, a type and a small `jsonb` payload — call it 250 B with
index overhead. 1 GB ÷ 250 B ≈ **4 M rows**; a 5-player game is maybe 400–600 actions, so ~7,000
complete games before storage binds, and the §4.6 reaper keeps it far below that.

Neon egress: 5 GB/project/month. The poll reads a handful of small rows; the 204 path reads one
`seq`. At ~1 KB average per poll, 660 K polls ≈ 0.7 GB. Fine. (Whether Neon counts
same-region-to-Vercel traffic against the 5 GB public-egress allowance is not something the docs
settle explicitly — treated here as if it does, which is the conservative reading.)

Vercel Fast Data Transfer: 100 GB. Negligible — ~1 GB of API responses plus the static bundle.

**Against the axes.** Zero cost ✅. Zero secrets in the browser ✅ — the only credential is an
`httpOnly` cookie the server sets, and `DATABASE_URL` never leaves the function. Survives a
refresh ✅ — the client re-reads the snapshot and resumes. Reconnect ✅ — `?since=` *is* the
reconnect protocol, and a client that has been away for an hour transparently gets a snapshot
instead of a delta. Player leaves ✅ — §4.4. Cheating ✅ — the client proposes, the server decides,
and the dice are the server's.

### 4.2 Option B — the same thing, but SSE for the ~5-minute window

**Shape.** `GET /api/games/:id/stream?since=<seq>` returns `text/event-stream`, holds open up to
300 s, and emits each new action as an SSE event with `id: <seq>`. The browser's `EventSource`
reconnects by itself and sends `Last-Event-ID`, which the handler reads as `since`. Latency drops
from 2–4 s to sub-second. Invocations collapse to **12 per player-hour** (one per 5 minutes) —
1 M would buy 83,000 player-hours.

**Why it is nevertheless the wrong first move.**

1. **The function still has to poll the database.** There is no `LISTEN`/`NOTIFY` to wait on
   (§2.4), so the handler runs a `select seq from games where id = $1` in a loop *inside* the
   stream. You have moved the poll from the browser (where it is free) to the function (where it
   costs Active CPU and keeps the Neon compute awake for the full connection). The 4-hour Active
   CPU allowance now covers a loop that runs for the whole session rather than a handler that
   returns in 10 ms.
2. **Provisioned Memory becomes the binding line, and it is unpredictable.** 360 GB-hr ÷ 2 GB
   (Hobby's fixed instance size) = **180 instance-hours/month** of held-open connection. Fluid's
   in-function concurrency packs many streams onto one instance — so the real capacity is
   `180 × (streams per instance)`, and Hobby cannot configure or observe that multiplier. A design
   whose cost model you cannot compute is worse than a slightly slower one you can.
3. **Neon compute stops being bursty.** Every open stream keeps the compute awake. Four players in
   a 90-minute game hold the compute for the full 90 minutes — which Option A also does, but
   Option A's compute goes to sleep 5 minutes after the last *poll*, while a stream that a dead
   client never closed keeps it awake until the 300 s cap.
4. **It buys latency the game does not need.** Turns last tens of seconds. Nobody notices 2 s.

**Verdict: build the `Sync` port so this is one adapter, and adopt it only if the invocation line
ever actually binds.** It is the correct second implementation and the wrong first one. If it is
ever adopted, the right hybrid is **SSE for the notification and the existing poll for the
payload** — the stream sends only `{seq}` and the client fetches the delta over the normal route,
so the stream handler does nothing but compare an integer.

### 4.3 Option C — Supabase Realtime for presence + broadcast, Postgres for state

Verified free tier (§2.5): **200 concurrent peak connections, 2 M Realtime messages/month**, 500 MB
database, 5 GB egress. A 5-player game spends ~6 messages per move, so a *busy* month of this game
is maybe 50 K messages — 2.5 % of the quota. Connection count is never close. The quota is not the
problem.

**It is genuinely the strongest push story.** The browser opens a WebSocket straight to Supabase,
bypassing Vercel's function model entirely — no 300 s cap, no instance pinning, no invocation
count. Presence is a first-class primitive, so the "who is online" list stops being a table you
poll and becomes a channel you subscribe to, which is what that feature wants to be. The `anon`
key in the browser is by design, protected by RLS, not a leak.

**Three reasons it is not the recommendation.**

1. **A second account and a second free tier.** The repo convention is one Vercel project per
   folder and Neon for data; `ArtWall` is the project that already *tried* Supabase and is now
   on Neon-plus-polling with the keys commented out in `.env.example` (§3.2). Going back adds a
   service whose free tier must independently be stayed inside, for a latency improvement the
   game does not need.
2. **Free-project pausing is fatal to a portfolio piece.** "Free projects are paused after 1 week
   of inactivity. Limit of 2 active projects"
   ([free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)), and
   inactivity is measured on **database** activity — so a Broadcast-only design can keep Realtime
   busy and still be paused. A portfolio replica's whole usage pattern *is* week-long silence
   punctuated by someone clicking a link, and a dead link is a worse failure than a 2-second poll.
   (It is recoverable — a few requests a day prevent it, and a paused project can be restored from
   Studio within a year — but "needs a keep-alive ping to stay reachable" is a liability a
   zero-maintenance replica should not take on, and Hobby cron can only ping once a day anyway.)
3. **It does not remove the server-authoritative engine.** Broadcast channels are peer-to-peer
   messages with a relay; trusting them means trusting clients. You still want moves to go through
   an authority that rolls the dice. So you end up with Supabase *plus* route handlers *plus*
   a database — more moving parts than Option A, not fewer.

**Where it would win.** If this were real-time (simultaneous turns, a timer ticking for everyone,
a live cursor on the map), or if the online-players list needed to be instant and large. Neither
is true.

### 4.4 Option D — Trystero P2P with a host-authoritative tab

**Shape.** Lobby discovery through a Postgres presence table (or a Trystero "lobby" room every
visitor joins); one visitor's tab holds the authoritative state and runs the engine; peers send
intents and receive the resulting actions. `super-smash/src/net/adapters/webrtc.ts` is a working
implementation of the transport, room codes and all.

**What kills it, specifically.**

1. **The host's tab is the database.** Close it, background it on iOS until the OS reclaims it, or
   lose WiFi, and the game's only copy of the state is gone. You can migrate the authority to
   another peer — but then you need a host-election protocol, a state-transfer protocol, a
   split-brain tiebreak, and a story for "the host left *during* the dice roll". That is more
   engineering than the whole of Option A, for a game where nobody minds a 2-second delay.
2. **A refresh is indistinguishable from a quit.** A player who hits ⌘R loses the WebRTC
   connection and has nothing to come back to. For a turn-based game sessions last long enough
   that someone *will* reload. Option A's `?since=seq` makes a refresh a non-event.
3. **No TURN server means some players simply cannot connect.** `super-smash` lists this in its
   own Known Gaps and is explicit that its design targets the LAN case where it does not matter.
   "Anyone who opens the website" is the opposite case. Trystero uses public STUN by default and
   relayed traffic needs your own `turnConfig`; Cloudflare's TURN has a 1,000 GB/month free tier,
   so it is *obtainable* — but it is one more account, one more credential, and it does not fix
   points 1, 2 or 4.
4. **Host-authoritative means the host can cheat trivially** — it holds the full state including
   anyone's cards, and rolls all the dice. Fine for two friends in a room; wrong for a public
   lobby, even casually.
5. **Discovery still needs a server.** The one thing Trystero cannot do is "show me the list of
   people on this site right now" — Trystero introduces peers who already know a room code.
   So you build the presence table anyway, which means you have Postgres, which means Option A
   is already half-built.

**What to steal from it anyway.** The transport-port shape (§3.4), and the room-code alphabet in
`webrtc.ts` — four uppercase letters minus `I` and `O`, "short enough to say in one breath, and
free of the pairs that get misheard", 24⁴ = 331,776 codes. That is exactly the right thing for a
shareable lobby code, and it is already written and tested.

### 4.4b Option E, for the record — Cloudflare Durable Object as a notification bus

Not one of the four the brief named, but it is the only option that beats A on latency *without*
giving anything up, so it belongs in the record. A ~100-line Worker holds one SQLite-backed Durable
Object per game. Clients open a WSS to it; when the Vercel route handler appends an action it
`fetch`es the DO with `{gameId, seq}`; the DO broadcasts that integer to its connected sockets;
each client then fetches the delta from the normal `GET /api/games/:id?since=` route. **The
authority never moves** — Postgres and the route handler stay exactly as designed — and the DO
holds no game logic, no state worth protecting and no secret the browser needs. WebSocket
Hibernation means an idle lobby accrues no billable duration, and 100,000 requests/day is far above
anything this project will see (§2.5).

The cost is a second deployment: a `wrangler deploy` alongside `npx vercel deploy --prod --yes`,
against the repo's one-project-per-folder convention. **Do not build it now.** Build the `Sync`
port so that this is an adapter plus a Worker, and take it only if somebody actually complains
about the 2-second delay — which, for a game where a turn is a minute, nobody will.

### 4.5 The design, concretely

#### 4.5.1 Schema

Source of truth: `src/adapters/db/schema.sql`, idempotent, applied by `db:push` in the build.
Written in the `ArtWall` style, with `check` constraints doing real work.

```sql
-- ─────────────────────────────────────────────────────── players + presence ──
-- The "temporary account". One row per visitor who claimed a name. Presence is
-- folded in rather than kept in a second table: for an account whose entire
-- lifetime IS the session, a separate presence row would have the same
-- lifetime, one more write per poll and one more join per read.
create table if not exists players (
  id            text primary key,                        -- 'p_' || 21 chars, client-minted
  display_name  text not null,
  name_key      text not null,                           -- lower(btrim(display_name))
  secret_hash   text not null,                           -- sha-256 of a server-minted secret
  color         text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  constraint players_name_len   check (char_length(btrim(display_name)) between 2 and 20),
  constraint players_name_chars check (display_name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$'),
  constraint players_color_hex  check (color ~ '^#[0-9A-Fa-f]{6}$')
);
create unique index if not exists players_name_key_uniq on players (name_key);
create index if not exists players_last_seen_idx on players (last_seen_at desc);

-- ───────────────────────────────────────────────────────────────── lobbies ──
create table if not exists lobbies (
  id           text primary key,                         -- 4-letter code, see §4.4
  host_id      text not null references players(id) on delete cascade,
  title        text not null,
  status       text not null default 'open',
  map_id       text not null default 'classic',
  max_seats    int  not null default 6,
  settings     jsonb not null default '{}'::jsonb,       -- fog, escalating cards, turn_seconds
  game_id      text,                                     -- set on start; FK added after games
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      bigint not null default 1,                -- bumped on every change; the ?since= for lobbies
  constraint lobbies_status  check (status in ('open','starting','playing','closed')),
  constraint lobbies_seats   check (max_seats between 2 and 6),
  constraint lobbies_title   check (char_length(btrim(title)) between 1 and 40)
);
create index if not exists lobbies_open_idx on lobbies (status, updated_at desc);

create table if not exists lobby_seats (
  lobby_id   text not null references lobbies(id) on delete cascade,
  seat       int  not null,
  kind       text not null default 'open',               -- open | human | bot
  player_id  text references players(id) on delete set null,
  bot_level  text,
  ready      boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (lobby_id, seat),
  constraint lobby_seats_kind  check (kind in ('open','human','bot')),
  constraint lobby_seats_shape check (
    (kind = 'human' and player_id is not null and bot_level is null) or
    (kind = 'bot'   and player_id is null     and bot_level is not null) or
    (kind = 'open'  and player_id is null     and bot_level is null))
);
-- One seat per player per lobby, enforced by the database rather than by a handler.
create unique index if not exists lobby_seats_one_per_player
  on lobby_seats (lobby_id, player_id) where player_id is not null;

-- ─────────────────────────────────────────────────────────────────── games ──
create table if not exists games (
  id            text primary key,
  lobby_id      text references lobbies(id) on delete set null,
  map_id        text not null,
  rules         jsonb not null,
  seed          text not null,            -- SERVER-ONLY. Never serialised to a client. §5.2
  status        text not null default 'playing',
  seq           bigint not null default 0,          -- == max(game_actions.seq); the version
  snapshot      jsonb not null,                     -- authoritative state AT snapshot_seq
  snapshot_seq  bigint not null default 0,
  state_hash    text not null,                      -- hash of snapshot; desync detector §5.5
  current_seat  int  not null default 0,
  phase         text not null,
  turn_deadline timestamptz,                        -- the auto-skip fence §4.5.4
  tick_lease    timestamptz,                        -- serialises concurrent lazy ticks
  winner_seat   int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint games_status check (status in ('playing','finished','abandoned'))
);
create index if not exists games_live_idx on games (status, updated_at desc);
alter table lobbies drop constraint if exists lobbies_game_fk;
alter table lobbies add  constraint lobbies_game_fk
  foreign key (game_id) references games(id) on delete set null;

create table if not exists game_players (
  game_id       text not null references games(id) on delete cascade,
  seat          int  not null,
  kind          text not null,                      -- human | bot (a human can become a bot)
  player_id     text references players(id) on delete set null,
  bot_level     text,
  display_name  text not null,                      -- denormalised: outlives player expiry
  color         text not null,
  standing      text not null default 'active',     -- active | eliminated | resigned | away
  missed_turns  int  not null default 0,
  last_seen_at  timestamptz,
  primary key (game_id, seat),
  constraint game_players_kind check (kind in ('human','bot'))
);
create index if not exists game_players_player_idx
  on game_players (player_id) where player_id is not null;

-- ───────────────────────────────────────────────────── the action log ──
-- Append-only. Contiguous seq per game, starting at 1, no gaps. This is the
-- single source of truth; `games.snapshot` is a cache of its fold.
create table if not exists game_actions (
  game_id          text   not null references games(id) on delete cascade,
  seq              bigint not null,
  seat             int    not null,
  type             text   not null,
  payload          jsonb  not null default '{}'::jsonb,   -- includes server-rolled dice §5.2
  actor            text   not null,                       -- human | bot | server
  client_action_id text,                                  -- idempotency key; null for bot/server
  state_hash       text   not null,                       -- hash AFTER applying this action
  created_at       timestamptz not null default now(),
  primary key (game_id, seq),
  constraint game_actions_actor check (actor in ('human','bot','server')),
  constraint game_actions_seq   check (seq > 0)
);
-- The idempotency fence: a retried POST hits this and becomes a no-op.
create unique index if not exists game_actions_idem
  on game_actions (game_id, client_action_id) where client_action_id is not null;

-- ───────────────────────────────────────────────────────────────── chat ──
create table if not exists chat_messages (
  id           bigserial primary key,
  scope        text not null,                        -- global | lobby | game
  scope_id     text,                                 -- null for global
  player_id    text references players(id) on delete set null,
  display_name text not null,                        -- denormalised, same reason
  body         text not null,
  created_at   timestamptz not null default now(),
  constraint chat_scope check (scope in ('global','lobby','game')),
  constraint chat_body  check (char_length(btrim(body)) between 1 and 300)
);
create index if not exists chat_scope_idx on chat_messages (scope, scope_id, id desc);
```

Three notes on the shape:

- **`games.seq` duplicates `max(game_actions.seq)` deliberately.** The poll's hot path is "has
  anything happened since `n`", and answering it from one indexed row in the `games` table is one
  cheap read; answering it with `max()` over the log is not. The duplication is maintained inside
  the same transaction that appends, so it cannot drift.
- **`display_name` is denormalised onto `game_players` and `chat_messages`.** A temporary account
  expires; a finished game's scoreboard should not turn into "(unknown)". The FK is
  `on delete set null` so the row survives the player.
- **`games.seed` is never sent to a client.** §5.2 explains why that is a correctness property and
  not just caution.

#### 4.5.2 The discoverable temporary account

**Claiming a name.** `POST /api/session { displayName }`:

1. Normalise: `btrim`, collapse internal whitespace, `name_key = lower(name)`.
2. Reap a dead holder of that name, conditionally and atomically:
   ```sql
   delete from players p
    where p.name_key = $1
      and p.last_seen_at < now() - interval '2 minutes'
      and not exists (select 1 from game_players gp
                       join games g on g.id = gp.game_id
                      where gp.player_id = p.id and g.status = 'playing')
      and not exists (select 1 from lobby_seats ls
                      where ls.player_id = p.id);
   ```
   **A name is held only while its owner is live** — so "Napoleon" is yours while you are here and
   free two minutes after you leave. A player sitting in a live game or a lobby is never reaped,
   however long they have been away, because their seat still refers to them.
3. Insert, letting the unique index arbitrate the race:
   ```sql
   insert into players (id, display_name, name_key, secret_hash, color)
   values ($1,$2,$3,$4,$5) on conflict (name_key) do nothing returning id;
   ```
   Zero rows → the name is genuinely taken by someone live. Respond `409` with suggestions
   (`Napoleon-2`, `Napoleon_1944`) produced by probing `name_key` with a suffix. Never silently
   rename — the player chose that name and should be told.
4. The **server** mints the secret (32 random bytes), stores `sha256(secret)` in `secret_hash`,
   and sets `risk_sid = <playerId>.<secret>` as an **`httpOnly`, `Secure`, `SameSite=Lax`** cookie
   with a 30-day `Max-Age`. **Nothing secret is reachable from JavaScript.** `localStorage` holds
   only the display name and colour, for instant first paint before the session route answers.
   (`id` is minted server-side too — a client-minted id is fine for a `nanoid`, but minting both
   in one place removes a whole class of "what if the client sends a colliding id" question.)
5. Every subsequent request authenticates by splitting the cookie and comparing
   `sha256(secret)` to `secret_hash` in constant time. That is the entire auth system: no
   passwords, no email, no library, and it survives a refresh and a browser restart.

**Being discoverable.** `GET /api/lobby?since=<v>` is the lobby screen's single poll and returns
`{ players: [...], lobbies: [...], chat: [...], version }` where `players` is

```sql
select id, display_name, color,
       (last_seen_at > now() - interval '45 seconds') as online
  from players
 where last_seen_at > now() - interval '5 minutes'
 order by last_seen_at desc limit 100;
```

…and the same request stamps the caller's own `last_seen_at`. **Heartbeat and read are one
invocation.** A 45-second online window against a ≤15-second poll means two missed polls before
you look offline — tolerant of a slow network, tight enough to be truthful.

**Expiry.** 2 minutes without a heartbeat → shown as away, name releasable. 24 hours → the row is
deleted by the reaper (§4.6) unless a live game references it.

#### 4.5.3 How bot turns run with no cron

Bots are not a background job. **A bot's turn is executed by the next poll that arrives**, inside
the same request, by the same pure engine. There is always at least one client polling whenever
anyone is watching — and when nobody is watching, nothing needs to happen. This is the whole
reason the Hobby cron restriction is irrelevant.

```
GET /api/games/:id?since=n
  ├─ 1 statement, HTTP fast path: read games.seq, current_seat, turn_deadline, tick_lease
  ├─ needs a tick?  (current seat is a bot)  OR  (turn_deadline < now())
  │    ├─ no  → if seq === n: 204 No Content.  else: return actions where seq > n
  │    └─ yes → take the lease, then run the tick in ONE transaction (WebSocket pool):
  │             UPDATE games SET tick_lease = now() + '10s'
  │              WHERE id = $1 AND (tick_lease IS NULL OR tick_lease < now())
  │             RETURNING seq;              -- 0 rows ⇒ another poll is already ticking;
  │                                         --   skip, answer from the log, next poll picks it up
  │             fold snapshot + actions > snapshot_seq  →  state
  │             loop, at most MAX_TICK_ACTIONS (≈40) times:
  │               action = isBot(current_seat) ? botPolicy(state, seat) : autoSkip(state, seat)
  │               state  = apply(state, action)        -- the same pure function
  │               append action with seq+1, state_hash
  │               stop when the current seat becomes a live human, or the game ends
  │             UPDATE games SET seq, snapshot, snapshot_seq, state_hash, current_seat,
  │                              phase, turn_deadline, tick_lease = NULL
  └─ return actions where seq > n  (now including the bot's)
```

`botPolicy(state, seat)` must be **pure** and live inside the engine, next to `apply` — which
means the exact same bot code powers solo-vs-bots in the browser and bot seats in an online game.
One implementation, one test suite. That is the main structural payoff of a pure engine and it is
free here.

The `MAX_TICK_ACTIONS` cap matters: a bot's full turn in Risk (deploy, several attacks, a fortify)
is a handful of actions, but a chain of three consecutive bot seats is not. Cap it, return what
was done, and let the next poll (2 s later) continue. The player sees the bots move in sequence,
which is better than a frozen four-second request anyway.

The lease (`tick_lease`) is what keeps two simultaneous polls from both running the bot. The
alternative — `select ... for update` on the games row — also works and is simpler to reason
about; the lease is preferred because a loser can answer immediately from the log instead of
blocking on a lock.

#### 4.5.4 Turn timer, leaving, reconnect — one mechanism

`games.turn_deadline` is set on every turn change to `now() + rules.turn_seconds` (default 90 s
for a human, unbounded display for a bot). On every poll's lazy tick:

| Condition | What the server appends |
|---|---|
| `turn_deadline` passed, phase has a legal "do nothing" | `end_phase` / `end_turn`, `missed_turns += 1` |
| `turn_deadline` passed, armies still undeployed | `auto_deploy` chosen by `botPolicy`, then `end_turn` |
| `missed_turns >= 2` **and** `last_seen_at` older than 2 min | `seat_to_bot` action → `game_players.kind = 'bot'`, `standing = 'away'` |
| That player polls again | `seat_to_human` action → `kind = 'human'`, `missed_turns = 0` |

Every one of those is a **row in the action log**, not a side-effect. So every client learns about
the takeover the same way it learns about a dice roll, replays it identically, and can render
"Napoleon went away — the bot took over" from the log. Reconnect is free: the returning player's
poll carries their cookie, the server flips the seat back, and the client replays from `?since=`.

A game where **every** human seat is away for 30 minutes → `status = 'abandoned'`, and the bots
stop being run (no poller, no tick — it simply stops, correctly).

#### 4.5.5 API routes

```
POST   /api/session                      claim a display name → sets risk_sid, returns {playerId, displayName, color}
PATCH  /api/session                      change colour / re-claim after expiry
DELETE /api/session                      leave: clear the cookie, release the name

GET    /api/lobby?since=<v>              THE lobby poll. online players + open lobbies + global chat
                                         + heartbeat. One invocation per tick.
POST   /api/lobbies                      create a lobby → {code}
GET    /api/lobbies/:code?since=<v>      THE lobby-room poll. seats + settings + lobby chat + heartbeat
POST   /api/lobbies/:code/join           take the first open seat (or a named seat)
POST   /api/lobbies/:code/leave          vacate; if host, hand the host to the next human or close
PATCH  /api/lobbies/:code                host only: title, map, rules, add/remove a bot, kick, ready
POST   /api/lobbies/:code/start          host only: create the game, return {gameId}

GET    /api/games/:id?since=<seq>        THE game poll. delta-or-snapshot + presence + deadline
                                         + game chat + heartbeat + the lazy tick. 204 when seq===since.
POST   /api/games/:id/actions            submit one action {clientActionId, type, payload}
POST   /api/games/:id/resign             resign; seat becomes a bot or is eliminated per rules
POST   /api/chat                         {scope, scopeId, body} — the only chat write; reads ride the polls

GET    /api/health                       the ArtWall precedent: one `select 1`
```

**Nine polling clients would be nine times the cost, so there are three poll endpoints and no
more** — one per screen, each returning everything that screen shows. Chat is never its own poll.
Presence is never its own request.

### 4.6 The lazy reaper

Garbage collection rides the polls too, bounded so no single request can be slow. Once every
~60 seconds per process (a timestamp on `globalThis`, same registry trick as `getDb()`), and with
`limit` on every statement:

| Sweep | Rule |
|---|---|
| Stale lobbies | `status='open'` and `updated_at < now() - 20 min` → `closed` |
| Abandoned games | every human seat `last_seen_at < now() - 30 min` → `abandoned` |
| Old games | `status in ('finished','abandoned')` and `updated_at < now() - 7 days` → delete (cascades the action log) |
| Dead players | `last_seen_at < now() - 24 h` and no live game/lobby seat → delete |
| Old chat | `created_at < now() - 7 days` → delete, `limit 500` |
| Snapshot compaction | when `seq - snapshot_seq > 50`, refold and rewrite `snapshot` |

One daily Hobby cron (`/api/cron/sweep`, the unbounded version of the same sweeps) is worth adding
as belt and braces for the case where nobody visits for a week — it is free, and once per day is
exactly what Hobby permits.

---

## 5. Determinism: the seq protocol, the dice, and idempotency

### 5.1 The engine contract

```ts
// src/engine/apply.ts — pure. No Math.random, no Date.now, no DOM, no fetch.
export function apply(state: GameState, action: Action): GameState;
export function legalActions(state: GameState, seat: number): ActionKind[];
export function validate(state: GameState, action: Action): Result<void, RuleError>;
export function botPolicy(state: GameState, seat: number, level: BotLevel): Action;
export function hashState(state: GameState): string;   // canonical-JSON → 64-bit hex
```

Enforced by a copy of `super-smash/src/engine/layering.test.ts`: the test reads the engine's own
source, strips comments and strings, and fails the build on any import of React/Next/`net`/`render`
and on any call to `Math.random`, `Date.now`, `performance.now`, `new Date` or `crypto.`.

Because `apply` is pure and total, the server and every client compute the same state from the
same log. That is the only property the whole sync design rests on.

### 5.2 Where randomness lives — and why `seed` never reaches the browser

Risk has three sources of randomness: the opening territory deal, the card deck, and attack dice.
The naive answer is "one seeded PRNG, seed in the state, everyone advances it identically". **That
answer is wrong here, for a reason that is about cheating rather than determinism:** if the PRNG
state is in the client's copy of the state, a modified client can run the generator forward and
read the next dice roll before deciding whether to attack. In a casual game that is the single
most attractive cheat available, and it costs nothing to close.

So the rule is: **the engine contains no randomness at all, not even a seeded generator. Every
random outcome is a value inside an action's payload, decided by the server at the moment it
happens.**

| Random thing | Where it is decided | What the log carries |
|---|---|---|
| Territory deal + seat order | server, at game creation, from `games.seed` | action `seq=1`, `game_started`, with the full assignment (public information anyway) |
| Card deck order | server-side only, derived from `seed`, **never serialised** | nothing — the deck's order is not in the state |
| A card draw | server, when the draw happens | action `card_drawn` with the concrete card |
| Attack dice | server, in `POST .../actions` | action `attack` with `payload.attackerDice: [6,4,2]`, `payload.defenderDice: [5,3]` |

`games.seed` stays in the database and in the function. It exists so a game is reproducible
*server-side* for debugging; it is not part of the protocol, and the response serialiser must not
be able to reach it (keep it off the `GameState` type entirely — it lives on the `games` row, not
in the snapshot).

The consequence for the client: **the client must not predict dice.** It submits `attack`, shows a
tumbling-dice animation, and resolves it when the authoritative action comes back with the numbers.
That is also exactly what the original game's UI does, so the constraint and the feel agree. Every
*other* action — deploy, fortify, end-phase, trade cards — is fully determined, so the client
applies it optimistically and the server's copy is identical. Only attacks ever show latency, and
they show it as a dice animation rather than as a spinner.

### 5.3 The seq/version protocol

**Invariants.**

1. `game_actions(game_id, seq)` is contiguous from 1, with no gaps and no reordering.
2. `games.seq = max(game_actions.seq)` for that game, maintained in the appending transaction.
3. `games.snapshot` equals `fold(apply, initialState, actions[1..snapshot_seq])`, and
   `games.state_hash = hashState(games.snapshot)`.
4. `game_actions.state_hash` is the hash *after* applying that action.

**Appending** (`POST /api/games/:id/actions`) — one transaction, over the WebSocket pool:

```sql
begin;
  select seq, snapshot, snapshot_seq, current_seat, phase, status
    from games where id = $1 for update;      -- serialises two submitters
  -- authorise: cookie → player → game_players.seat; reject if seat <> current_seat
  -- fold forward to `state`, then validate(state, action); reject 422 on a rule error
  -- roll dice server-side; splice into payload
  insert into game_actions (game_id, seq, seat, type, payload, actor, client_action_id, state_hash)
       values ($1, $seq + 1, ...);            -- unique(game_id, client_action_id) → 23505 on a retry
  update games set seq = $seq + 1, snapshot = $newState, snapshot_seq = $seq + 1,
                   state_hash = $hash, current_seat = $next, phase = $phase,
                   turn_deadline = $deadline, updated_at = now()
   where id = $1;
commit;
```

Response: `{ seq, actions: [theOneJustApplied] }` — so the submitter does not need an extra poll
to see its own confirmed move.

`FOR UPDATE` is the fence that matters. Without it, a double-clicked "Attack" produces two
`insert`s racing for `seq + 1`; the primary key would reject the second, but with an error the
player did not cause. With it, the second submitter blocks, re-reads, and finds the first action
already there — and the idempotency index turns it into a no-op if it is the same intent.

**Polling** (`GET /api/games/:id?since=n`):

```
seq === n                 → 204 No Content           (the common case)
n >= snapshot_seq         → { seq, fromSeq: n, actions: [...] }         -- delta
n <  snapshot_seq, n > 0  → { seq, snapshot, snapshotSeq, actions: [...] }  -- behind the compaction
n === 0 (cold client)     → { seq, snapshot, snapshotSeq, actions: [] }
```

Plus `presence`, `turnDeadline`, `chat` and `you` (your seat, your cards) on every non-204
response. `ETag: W/"<seq>"` and `If-None-Match` so the 204 path is a string comparison.

**The client's loop.**

```
confirmedState  ← fold(apply, snapshot, actions)       -- authoritative
pendingActions  ← my optimistic actions, not yet confirmed
displayedState  ← fold(apply, confirmedState, pendingActions)

on poll response:
  for each action in order of seq:
     if action.clientActionId is one of mine → drop it from pendingActions (confirmed)
     confirmedState = apply(confirmedState, action)
     assert hashState(confirmedState) === action.stateHash     -- §5.5
  displayedState = fold(apply, confirmedState, pendingActions)
```

A dropped response, a duplicated response and an out-of-order response are all handled by the same
code: `seq` is the only thing that orders anything, actions below `since` are never re-applied, and
a client that has fallen behind the compaction horizon gets a snapshot instead. There is no case
where the client has to reason about the network.

### 5.4 Idempotency

The client mints `clientActionId = crypto.randomUUID()` **once per player intent** and reuses it
verbatim on every retry. Three layers then make a retry safe:

1. `unique (game_id, client_action_id) where client_action_id is not null` — the database refuses
   the duplicate.
2. The handler catches Postgres `23505` on that index and responds `200` with the *already
   recorded* action and `seq`, not an error. A retry is indistinguishable from a slow success.
3. The client keeps the id in its `pendingActions` entry, so even a response lost twice converges.

The id must be generated at the point of *intent* (the click), not at the point of *send*. That
distinction is the whole value: a resend with a fresh id is a second attack.

### 5.5 Desync detection

Every action row carries `state_hash`. The client asserts after each apply, and on mismatch it
does **not** try to reconcile — it drops its local state, refetches the snapshot, and reports the
mismatch (console + a `POST /api/health` style beacon, or in dev a thrown error). A desync is a
bug in `apply`, and the only useful response is to make it loud and recoverable. `super-smash`
already carries `src/engine/hash.ts` for exactly this purpose.

The hash must be over a **canonical** serialisation — sorted keys, integers not floats, no
`undefined` — or it will report false desyncs from key ordering. Write it as a pure function in
the engine with its own property test (`fast-check` is already a dev dependency across the
siblings): `∀ state. hashState(state) === hashState(roundTrip(state))`.

---

## 6. Local dev and two-context e2e

### 6.1 The local setup

`DATABASE_URL` unset → `DB_DRIVER` resolves to `pglite` → one in-process WASM Postgres at
`.data/risk`. `npm install && npm run dev` and an online game works **between two browser windows
on one machine**, with no service to install and no account. That is the whole point of the
`island-empire` adapter pair, and it is worth more here than it was there: the thing being
developed *is* the multi-client behaviour.

The one hazard: PGlite is single-writer and a second instance against the same `dataDir` corrupts
the WAL. The `Symbol.for("risk.db")` registry on `globalThis` (§3.1b) is what prevents Next's
multiple module graphs from opening several. Copy it verbatim; it is not optional.

### 6.2 Two browser contexts in Playwright

Two Playwright **contexts** from one browser is exactly the right primitive: separate cookie jars
and separate `localStorage`, same server, same database.

```ts
// e2e/helpers.ts
export async function twoPlayers(browser: Browser) {
  const [a, b] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pa, pb] = await Promise.all([a.newPage(), b.newPage()]);
  await Promise.all([signIn(pa, "Alpha"), signIn(pb, "Bravo")]);
  return { a, b, pa, pb };
}
```

Because each context has its own cookie jar, `POST /api/session` sets a different `risk_sid` in
each, and the two pages are genuinely two players. `browser.newPage()` *without* a new context
would share cookies and both tabs would be the same player — which is also a test worth having
(two tabs, one account, both should work and stay in sync), but it is not the two-player test.

Five things the config must pin:

```ts
// playwright.config.ts  — following island-empire's, which already solves most of this
const PORT = Number(process.env.PORT ?? 3300);   // siblings hold 3000/3100/3200
export default defineConfig({
  fullyParallel: false,
  workers: 1,                     // ← REQUIRED: one server process, one PGlite, one shared DB
  webServer: {
    command: `pnpm run build && pnpm exec next start --port ${PORT}`,
    timeout: 600_000,
    env: {
      DB_DRIVER: "pglite",
      DB_DATA_DIR: ":memory:",                      // fresh database per run
      E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true",    // next start is NODE_ENV=production
      RISK_TURN_SECONDS: "3",                       // so the auto-skip test finishes
      RISK_FIXED_SEED: "e2e-seed",                  // deterministic territory deal
      NEXT_PUBLIC_RISK_DEBUG: "1",                  // installs window.__riskDebug
    },
  },
});
```

- **`workers: 1` and `fullyParallel: false` are load-bearing**, not tidiness. Two workers means two
  `next start` processes means two PGlite instances means the two players are in different
  universes. (The siblings already set both, for a different reason — Turbopack flakiness — so the
  config is copy-paste.)
- **A production build, not `next dev`** — island-empire's reason applies ("a dev server compiles
  each route the first time something asks for it, and that cost lands inside whichever assertion
  is first through a page"), and here it compounds: the first poll of a 2-second loop would eat the
  compile.
- **`PORT` must differ from the siblings'** (3000 super-smash, 3100 Linear, 3200 island-empire →
  **3300**). Every sibling config carries a comment about this because it has already happened.

### 6.3 Driving the loop instead of waiting for it

The naive two-player test sleeps 2.5 s after every move and takes ten minutes. Instead, expose a
debug handle (the `super-smash` `window.__smashDebug` pattern) and **drive the poll**:

```ts
// installed only when NEXT_PUBLIC_RISK_DEBUG === "1"
window.__riskDebug = {
  seq:   () => confirmedSeq,
  state: () => structuredClone(confirmedState),   // simulation truth, not pixels
  pollNow: () => pollOnce(),                      // resolve when the response is applied
  setInterval: (ms: number) => { pollEveryMs = ms },
};
```

The helper that every test uses:

```ts
async function sync(...pages: Page[]) {
  await Promise.all(pages.map(p => p.evaluate(() => window.__riskDebug.pollNow())));
}
async function expectSeq(page: Page, seq: number) {
  await expect.poll(() => page.evaluate(() => window.__riskDebug.seq())).toBe(seq);
}
```

So the canonical test reads:

```ts
test("a move by one player appears for the other", async ({ browser }) => {
  const { pa, pb } = await twoPlayers(browser);
  const code = await createLobby(pa, { seats: 2 });
  await joinLobby(pb, code);
  const gameId = await startGame(pa);

  await sync(pa, pb);
  const before = await pb.evaluate(() => window.__riskDebug.state());

  await deploy(pa, "ukraine", 3);          // POST, then pa re-polls automatically
  await sync(pb);                          // drive pb's poll rather than sleeping

  const after = await pb.evaluate(() => window.__riskDebug.state());
  expect(after.territories.ukraine.armies).toBe(before.territories.ukraine.armies + 3);
  expect(after.currentSeat).toBe(before.currentSeat);   // deploying does not end the turn
});
```

Asserting on `__riskDebug.state()` rather than on the canvas is the `super-smash` lesson repeated:
"pixels can only tell you something was painted… [not] whether the simulation moved". For the
canvas map, the *renderer* gets its own unit tests; e2e asserts the simulation and the DOM chrome.

### 6.4 The e2e cases that actually matter here

| Test | What it proves |
|---|---|
| Two contexts, one move, both see it | the whole sync path, end to end |
| Both claim the same name | `409` + suggestions, no duplicate row |
| B refreshes mid-game | `?since=` reconnect; identical state after reload |
| B's context closed, `RISK_TURN_SECONDS=3` elapses | auto-skip, then bot takeover, both recorded as actions |
| B reopens and polls | `seat_to_human`, turn order intact |
| Both submit at once (`Promise.all` on two POSTs) | `FOR UPDATE` serialises; contiguous `seq`; the non-current seat gets `409`/`422` |
| The same POST sent twice with one `clientActionId` | one action row, both responses `200` with the same `seq` |
| A 3-seat game with 2 bots | bots run on the poll with no cron; `MAX_TICK_ACTIONS` chaining works |
| Client replays the log from `seq=0` | `hashState` matches every `state_hash` — determinism, asserted |
| A lobby with no humans for 20 min (clock-forced) | the lazy reaper closes it |

The last-but-one is the one to write first. It is the determinism proof, it needs no second
context, and every other guarantee in this document depends on it.

### 6.5 Testing the cost assumptions

Two things in §4.1 are *estimates* and should be measured rather than believed, both cheaply:

- **CPU per poll.** Add a dev-only `Server-Timing` header on the poll route and read it in a
  Playwright test that drives 200 polls. If the 204 path is not under ~5 ms, the Active CPU
  arithmetic changes and the interval needs to grow.
- **Response size.** Assert in a test that the 204 path has no body and that a one-action delta is
  under 1 KB. The transfer line has 100× headroom, so this is really a proxy for "we did not
  accidentally start returning the whole snapshot every poll" — which is the single regression that
  would blow the budget.

---

## 7. What this means for the build

1. Copy `island-empire/src/adapters/db/*`, `src/config/env.ts`, `scripts/db-push.ts`,
   `scripts/build-schema.mjs`, `vercel.json`'s `buildCommand`, and the `next.config.ts` shape.
   Change `Symbol.for("island-empire.db")` → `Symbol.for("risk.db")`.
2. Write the engine first, pure, with the layering test from `super-smash` and the `hashState`
   property test. `botPolicy` goes in the engine, so solo and online share it.
3. Put the client's sync behind a `Sync` port shaped like `super-smash/src/net/transport.ts`, with
   a `PollingSync` adapter now and room for `SseSync` later. The port is the reason Option B stays
   a cheap decision rather than a rewrite.
4. Three poll endpoints, each returning everything its screen needs. Resist a fourth.
5. 204 on no-change, delta otherwise, snapshot only when cold or behind. This is the cost design
   and the correctness design at the same time.
6. Stop polling when hidden. This is the Neon design.
7. Dice are server-rolled and live in the payload. `games.seed` never leaves the server.
8. `clientActionId` per intent, `FOR UPDATE` on append, `state_hash` on every row.
9. No cron in the critical path; one daily sweep as insurance.
10. `workers: 1`, PGlite `:memory:`, port 3300, `__riskDebug.pollNow()`.

---

## Sources

**Vercel**
- [Limits](https://vercel.com/docs/limits) — general limits (200 projects, 100 deployments/day, 1 concurrent build, 45-min build, 120 s proxied timeout, 1-hour Hobby log retention) and the pre-Fluid duration table (Hobby 10 s / 60 s).
- [Fair Use Guidelines § Typical monthly usage guidelines](https://vercel.com/docs/limits/fair-use-guidelines) — Hobby allotments: 100 GB Fast Data Transfer, 1,000,000 Function Invocations, 10 GB Fast Origin Transfer, **4 hours Active CPU**, **360 GB-hrs Provisioned Memory**. Also the commercial-use restriction on Hobby.
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — Fluid duration table (**Hobby 300 s default and maximum**), memory (**Hobby 2 GB / 1 vCPU, not configurable**), 250 MB bundle, 4.5 MB request/response body, 30,000 concurrency, 1,024 file descriptors, and the Active-CPU definition ("Waiting for I/O … does not count").
- [Fluid compute](https://vercel.com/docs/fluid-compute) — "enabled by default for new projects" as of 23 April 2025; default settings by plan; in-function concurrency and shared instances.
- [Streaming](https://vercel.com/docs/functions/streaming-functions) — streaming on by default for Node.js; duration governed by `maxDuration`.
- [Max duration § Edge runtime](https://vercel.com/docs/functions/limitations#max-duration) — Edge must begin responding within 25 s and may stream up to 300 s.
- [Do Vercel Functions support WebSocket connections?](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections) — public beta on all plans since 22 June 2026; requires Fluid; Hobby 300 s; connection pins to an instance; "Without a shared store, two clients in the same chat room can connect to different instances and never see each other's messages."
- [Publish and subscribe to realtime data on Vercel](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel) — WebSockets vs SSE vs Redis vs Queues; when to use a managed provider; "Polling skips the open connection and the coordination primitive underneath it."
- [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — **Hobby: 100 jobs, once per day minimum interval, ±59 min precision**; more frequent expressions fail at deploy.

**Neon**
- [Plans](https://neon.com/docs/introduction/plans) — Free: 1 GB/project storage (20 GB account), **100 CU-hours/project/month** ("enough to run a 0.25 CU compute … for 400 hours/month"), 100 projects, 10 branches, 5 GB egress/project, scale-to-zero after 5 min and "fixed" on Free.
- [Usage metrics](https://neon.com/docs/introduction/usage-metrics) — `compute size × hours running = CU-hours`; 1 CU ≈ 4 GB RAM; storage metered hourly as GB-months.
- [Scale to zero](https://neon.com/docs/introduction/scale-to-zero) — 5-minute autosuspend, "reactivates automatically within a few hundred milliseconds", setting fixed on Free.
- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) — "Use the driver over HTTP by default"; WebSocket `Pool`/`Client` only for interactive transactions/sessions/node-postgres compatibility.
- [What is the best backend for a real-time app with chat, presence, or live updates?](https://neon.com/faqs/best-backend-real-time-chat-presence-live-updates) — LISTEN/NOTIFY unsupported on the pooled endpoint; pair Postgres with a pub/sub service.
- [Real-time notifications using pg_notify](https://neon.com/guides/pg-notify) — NOTIFY/LISTEN last only for the session, lost on scale-to-zero.

**Supabase**
- [Pricing](https://supabase.com/pricing) — Free: 500 MB database, 1 GB file storage, 5 GB egress, 50,000 MAU, **200 Realtime peak connections, 2 M Realtime messages/month**; "Free projects are paused after 1 week of inactivity. Limit of 2 active projects."
- [Realtime quotas](https://supabase.com/docs/guides/realtime/quotas) — per-connection Free limits: 100 msgs/sec, 100 joins/sec, 100 channels/connection, 256 KB payload, 10 presence keys.
- [Realtime messages usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) — message accounting (Postgres Changes = 1 per listening client; Broadcast = 1 + 1 per subscriber).
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) — private channels, RLS on `realtime.messages`.
- [Realtime broadcast](https://supabase.com/docs/guides/realtime/broadcast) — `realtime.send()` / `broadcast_changes()`, 72-hour row retention, and the daily-partition gotcha.
- [API keys](https://supabase.com/docs/guides/api/api-keys) — the publishable key is "safe to expose"; legacy JWT keys deprecated by end of 2026.
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)

**Upstash**
- [Redis pricing](https://upstash.com/pricing/redis) and [pricing docs](https://upstash.com/docs/redis/overall/pricing) — Free: 500 K commands/month, 256 MB, 10 GB bandwidth.
- [REST API](https://upstash.com/docs/redis/features/restapi) — `SUBSCRIBE` over Server-Sent Events; unsupported blocking/WATCH/cluster commands.
- [Limits increase](https://upstash.com/blog/limits-increase) — 10 K concurrent connections / 10 K tps soft limits across plans.
- [max_concurrent_connections](https://upstash.com/docs/redis/troubleshooting/max_concurrent_connections)

**Ably / Pusher**
- [Ably pricing](https://ably.com/pricing) — Free: 6 M messages/month, 500 msgs/sec, 200 connections, 200 channels, 64 KiB messages, 1-day history.
- [Pusher Channels pricing](https://pusher.com/channels/pricing/) — Sandbox: 200 K messages/day, 100 concurrent connections.

**PartyKit / Cloudflare**
- [partykit/partykit](https://github.com/partykit/partykit) and [cloudflare/partykit](https://github.com/cloudflare/partykit) — development moved to Cloudflare; "Work in Progress".
- [partykit#985](https://github.com/partykit/partykit/issues/985) — hosted deploys failing since 2026-06-18 on the exhausted `partykit.dev` Workers-custom-domain limit.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — DO on Workers Free, **SQLite backend only**; 100 K requests/day, 13 K GB-s/day, 5 M rows read/day, 100 K rows written/day, 5 GB stored.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — Free: 100 K requests/day, 10 ms CPU/request, 50 subrequests.
- [Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — Hibernation: "Billable Duration (GB-s) charges do not accrue during hibernation."

**Firebase**
- [Pricing](https://firebase.google.com/pricing) — Spark RTDB: **100 simultaneous connections**, 1 GB stored, 10 GB/month downloaded.
- [API keys](https://firebase.google.com/docs/projects/api-keys) — Firebase API keys "do not need to be treated as secrets"; security comes from Rules and App Check.

**Trystero / PeerJS**
- [trystero on npm](https://registry.npmjs.org/trystero/latest) — **0.26.0, published 2026-10-04**.
- [Trystero README](https://github.com/dmotz/trystero) — seven strategies, scoped `@trystero-p2p/*` since 0.23.0; **"By default Trystero uses the Nostr network"**, with MQTT, BitTorrent and IPFS recommended in that order of robustness; TURN requires your own `turnConfig` (Cloudflare TURN's free tier is 1,000 GB/month).
- [Trystero releases](https://github.com/dmotz/trystero/releases) — 0.26.0 Nostr relay/retry hardening, `onReceive` filtering, 256 MiB default payload cap; 0.25.4 honours tracker announce intervals.
- [PeerJS FAQ](https://peerjs.com/client/faq) — the public cloud "handles signaling for free"; a connection offer may be held up to 5 seconds.
- [peerjs#997](https://github.com/peers/peerjs/issues/997) and [peerjs-server](https://github.com/peers/peerjs-server) — the public cloud's concurrency limit is undocumented; 5000 is the *self-hosted* `concurrent_limit` default.

**Not verified — treat as inference, not citation**
- Upstash's per-plan concurrent-connection figure (only the cross-plan 10 K soft limit from a 2025 blog post).
- Whether a *claimed* Upstash free database is ever paused or evicted for inactivity (only the 3-day unclaimed-instant-DB deletion is documented).
- Ably's and Pusher's browser key/token-auth requirements were not re-fetched from their own docs in this pass.
- Max concurrent WebSockets per Durable Object, and explicit free-plan confirmation of the Hibernation API.
- PartyKit hosted free-tier numbers, and whether any official sunset notice exists.
- PeerJS public-cloud concurrency/rate limits and TURN availability.
- Trystero's guidance on max peers per room.
- Whether Neon counts same-region Vercel→Neon traffic against the 5 GB public-egress allowance (§4.1 assumes it does, which is the conservative reading).


**Local code read for this lane**
- `island-empire/src/adapters/db/{driver,pglite,neon,index}.ts`, `src/config/env.ts`, `scripts/db-push.ts`, `next.config.ts`, `vercel.json`, `playwright.config.ts`, `.env.example`, `research/00-repo-conventions.md`
- `ArtWall/README.md`, `.env.example`, `next.config.ts`, `lib/db/server.ts`, `lib/api/wall.ts`, `app/api/wall/route.ts`, `scripts/{db-push.ts,schema.sql}`, `components/wall/art-wall.tsx`
- `super-smash/README.md` ("Multiplayer", "Deploying", "Known gaps"), `DECISIONS.md` (D9, D20), `src/net/transport.ts`, `src/net/adapters/webrtc.ts`
- `Linear/src/config/env.ts`, `src/app/api/**/route.ts`
- `Replicates/README.md`
