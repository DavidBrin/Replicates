# Research lane 2 — Sibling project dossiers (article source material)

Extracted 2026-08-18 from each sibling project's README. These facts are the source
of truth for the encyclopedia articles; do not invent facts not present here or in
the READMEs.

## Linear — "the issue tracker, rebuilt from measurements"

Hook: *four people, four permission levels, one keyboard.*
A rebuild of Linear.app — issues, projects, teams — with enforced membership across
four roles. Notable: colours measured from the running product, not the marketing
site (real chrome is `#09090a` around a `#121213` pane); status-glyph progress wedge
uses radius 1.94 not 2 (a deliberate 3% shortfall); fractional-index *string*
ordering instead of Linear's float `sortOrder` (floats exhaust double precision
after ~50 inserts into one gap); `collate "C"` declared explicitly; authorization is
one table checked exhaustively by the compiler via `satisfies`, with a hand-transcribed
416-case test matrix; a DAG tab per team that real Linear lacks. Codex reviews found
18 + 20 + 7 issues (CSS `url()` injection via label names, an invite endpoint leaking
an email, unthrottled scrypt endpoints). Stack: Next.js 16, PGlite locally / Neon in
production. 1,559 unit tests, 23 e2e (README; root README says 1,314/9 — stale).
Built from six research lanes, seven build slices.
Screenshots: `Linear/docs/screenshots/{issue-list,issue-detail,board,projects,command-palette,members,marketing,dag}.png`

## Notion — marketing site + product, one session

A working replica of Notion: block editor (15 block types, slash menu, markdown
shortcuts, nesting, split/merge), database views (board/table/list/calendar) with
filters/sorts/grouping, 13 property types, sharing with 4 access levels, ⌘K palette,
dark mode, JSON export/import — all persisted in IndexedDB (no backend). Notable:
palette pulled from Notion's shipped CSS custom properties (`#f9f8f7`, warm greys —
"why Notion reads as paper"); database rows *are* pages, mirroring the real data
model; custom contentEditable editor rather than ProseMirror to avoid a lossy
mapping; IndexedDB over localStorage citing WebKit's 7-day eviction; four
StorageAdapter implementations. 147 tests. Built by parallel research agents, a
single-threaded foundation, then 4 parallel surface agents. No SPEC/DECISIONS docs;
no screenshots directory. Deploys to Vercel with no env vars (all client-side).

## youtube — "the server never opens a codec"

A rebuild of YouTube's core: upload, adaptive player, channels, subscriptions,
playlists, threaded comments, search, recommender, watch history, Shorts, Content ID.
The bet: the uploader's browser encodes the whole rendition ladder via `VideoEncoder`
before upload — no transcode queue, worker pool or backlog exists server-side.
Hand-written MP4 demuxer, fMP4 muxer, HLS packager and MSE player with its own ABR
(no ffmpeg.wasm / mp4box.js / hls.js). Content ID is Wang's (ISMIR 2003) landmark
fingerprinting with a threshold *derived* from 3,086 leave-one-out pairs (250 ≈
2.5×10⁻⁵ FP/pair); recommender after Davidson et al., RecSys 2010. Measured from the
real site: brand red `#f03`; home grid is 3×533px at 1920w; `--yt-spec-*` is a dead
namespace (live system is `--yt-sys-*`). 37 icon glyphs drawn from geometry. Every
seed video is synthetic, generated through the real WebCodecs path. Recurring bug
class: client-reference leakage across the RSC boundary (5 occurrences, invisible to
2,227 unit tests; finally caught by an AST-based check). 2,227 unit tests, 38 e2e
specs, 23-table schema on PGlite/Neon. Nine research lanes, twelve build slices,
five codex rounds (~72 findings).
Screenshots: `youtube/docs/screenshots/{replica-home-1920,replica-watch-1920}.png`

## super-smash — "eight fighters, one keyboard, sixty frames a second"

A browser rebuild of Super Smash Bros. Ultimate's versus mode. Knockback equation is
Ultimate's, stage geometry from Kurogane Hammer, frame data from decompiled scripts.
Every fighter drawn from code (bone hierarchy of capsules/circles) — no Nintendo
assets; every sound synthesised from oscillators. Adds rollback netcode over WebRTC
(the original is delay-based): Q12 fixed-point simulation, seeded PRNG inside
GameState, a layering test that fails the build on `Math.random`/`Date.now`/
transcendental Math in the engine; 2 frames input delay, 8-frame prediction cap;
shared-WiFi LAN path needed no code (ICE host candidates). Verified against a
ground-truth run at six link conditions (up to 150ms+40ms jitter, 82 rollbacks).
8 of 89 fighters, chosen to span archetypes. 1,285 unit/property tests, 7 e2e.
Eight research lanes, frozen engine contract, six build slices.
Screenshots: `super-smash/docs/screenshots/{title,main-menu,character-select,stage-select,rules,match,match-2,controls}.png`

## fake-phone — "never feel alone"

A personal-safety web app replicating the iOS and Android incoming-call screens plus
a live-stream mode over the real camera. Opens directly into a ringing call; ending
the call is the only way into settings (doubles as social cover). Three voice tiers:
Silent, Scripted (default), AI (fully wired, completely inert without an API key —
falls back silently rather than sticking on "connecting"). Honest platform limits
documented: mobile Safari suspends timers when locked (60s cap), no vibration API on
iOS. Apple Guideline 1.1.6 (bans "prank call" apps) treated as a hard constraint on
all product language. Installable PWA. 363 unit tests, 89 e2e across mobile Safari,
mobile Chrome, desktop. Six research lanes, six build slices.
Screenshots: `fake-phone/docs/screenshots/{home,home-full,ios-incoming,ios-in-call,android-incoming,android-in-call,live-streaming,live-primer,ring-countdown}.png`

## bet — a private, friend-first prediction market

Play-money prediction markets scoped to a friend group, each with an embedded
groupchat; a public read-only Explore surface styled as a Kalshi/Polymarket hybrid.
Priced with Hanson's LMSR (`C(q) = b·ln Σ exp(qᵢ/b)`) rather than an order book —
"a CLOB with six friends is an empty book." Three pricing engines behind one
interface (LMSR, fixed odds, parimutuel). Unauthorized reads return 404 not 403
(a 403 confirms existence). Property-based tests (fast-check) guard pricing
invariants; the round-trip property was strengthened after `Math.abs` masked a
sign-flip. Known gaps documented candidly: in-memory store resets on cold starts;
no passwords. ~664 unit/property/route tests. Built from a 14-task plan with
implementer + independent reviewer + fix loop per task.
Screenshots: none on disk (README references a directory that does not exist).

## dollar-pixels — "$1 buys nine pixels"

A rebuild of the 2005 Million Dollar Homepage, selling 3×3 blocks for $1 on a
1200×1200 grid (160,000 blocks) — 1200 because 1000 is not divisible by 3. Blocks
deliberately carry no outbound links: a 2017 study found 547 of the original's
links dead (~$342,000 of spend pointing at nothing) and the surviving mirror has
rewritten 1,164 more to archive snapshots. Adds what the original could not: buy a
page of your own (Unlisted $10 with 69 free blocks; Premium at half face value,
paying its creator per block sold). Play money by default; Stripe one env var away
through the same `settle()` path. Canvas renderer with O(1) hit-testing. Review
found five money-path bugs where "both halves were individually correct" (e.g. a
webhook marking an event processed before settling it). 414 unit/property tests,
30 e2e. Five research lanes, five build slices.
Screenshots: `dollar-pixels/docs/screenshots/{the-wall,selecting,zoomed,checkout,new-page,directory,landing}.png`

## Root repo

"Exploring Agentic Software Development through building established software
products from scratch in just a few prompts." Each folder self-contained with
README/SPEC/DECISIONS/research. No live URLs exist yet for any project — hence the
Wikipedia replica's stub external links.
