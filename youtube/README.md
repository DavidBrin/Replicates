# youtube — the video platform, with the transcoding moved to the uploader

> **the server never opens a codec**

A rebuild of [YouTube](https://www.youtube.com)'s core: upload, an adaptive
player, channels, subscriptions, playlists, threaded comments, search, a
recommender, watch history, Shorts, and Content ID.

The architectural bet is one line long: **the uploader's browser encodes the
whole rendition ladder before anything is sent.** Transcoding is the most
brutal cost a video platform carries and it scales with uploads rather than
with revenue, so this project moves it to the one machine that is already idle
and already holding the source file. The server's entire job on the media path
becomes accepting opaque byte ranges and handing them back.

What that buys is not merely cheapness — it is that the expensive part of the
system **does not exist**. There is no transcode queue, no worker pool, no
job-retry semantics, no backlog to monitor.

`pnpm install && pnpm dev` and it runs: Postgres compiled to WebAssembly, so
there is no database to install, and the same SQL runs on Neon when deployed.

---

## The media pipeline is ours, end to end

`VideoEncoder` hands back an `EncodedVideoChunk` — a bare bitstream with a
timestamp. It is not a container and not anything a browser can play.
Everything between that and a playing video is code in this repository:

```
your file → MP4 demuxer → VideoDecoder → one decode pass
                                            ↓ fanned out
                              ladder ← VideoEncoder ×N
                                            ↓
                    fMP4 muxer (ftyp/moov/moof/mdat, hand-written)
                                            ↓
                              HLS packager → BlobStore
                                            ↓
              our HLS parser → MediaSource → our buffer controller → our ABR
```

No `ffmpeg.wasm`, no `mp4box.js`, no `hls.js`, no `mux.js`. The muxer's
initialisation segment reproduces a reference built by an **independent
generator** — a script written during the research lane from the ISO BMFF field
tables, sharing no code with the muxer — box for box: all 23 declared sizes,
the 640-byte total, and the header bytes the reference recorded. ISO publishes
field tables rather than a worked binary, so the reference is ours; what makes
it evidence is that it was produced before this code existed and not from it.

The demuxer exists because WebCodecs decodes but does not demux, and the
alternative was a real-time pipeline where a ten-minute upload takes ten
minutes. Its round-trip test uses a **second, independently written** MP4
writer, because a round-trip whose writer shares code with its reader passes
happily on compensating bugs.

## Content ID, which is the part nobody clones

Landmark audio fingerprinting after Wang's ISMIR 2003 method: STFT, a spectral
peak constellation, combinatorial hashing of `(f1, f2, Δt)` triples, and a
match declared by a spike in the histogram of time-offset differences. It runs
in the Worker pass that is already decoding the audio for transcoding, so
matching costs the server nothing — the same trick as the transcode thesis,
applied to copyright.

The match threshold is **derived, not chosen**: 3,086 leave-one-out
non-matching pairs, a false-positive distribution characterised to p99.9 with a
maximum observed coincidence of 204, and an exponential tail that places the
shipped threshold of 250 at roughly 2.5 × 10⁻⁵ per pair.

The largest loss in the pipeline is one the literature does not mention. A
query clipped at an arbitrary sample offset has its STFT grid displaced from
the reference's, and because Δt is a *difference* of frame indices the hash key
itself changes: 1,389 matching tokens at zero displacement against 194 at a
256-sample cut. A factor of seven from nothing but where the clip was trimmed.

**What it cannot do:** survive pitch shift, time stretch or speed change —
precisely the evasions uploaders actually use. That is recorded as a limit
rather than papered over.

## The recommender is the real one

Co-visitation after Davidson et al., RecSys 2010
([10.1145/1864708.1864770](https://doi.org/10.1145/1864708.1864770)) — not a
small-scale substitute, but what YouTube actually ran. The paper's headline is
narrower than it is usually quoted: **207% of a most-viewed baseline** is
click-through on *browse* pages over 21 days, deliberately not the home page,
because of presentation bias.

Two ways to get it quietly wrong, both of which this project got wrong first:

- **The normaliser is a distinct-session count, not a view count.** They
  diverge the moment anyone rewatches anything, and using views penalises a
  rewatched video for being rewatched.
- **Co-visitation must be deduplicated within a session.** Without a membership
  set, a viewer replaying one video four times re-increments every pair it
  touches, and the counts quietly become "watched together, weighted by replay
  count" — inflating exactly the popular pairs the recommender leans on hardest.

Both produce recommendations that look entirely plausible while being wrong.

## Everything is measured, and nothing is an asset

Layout values come from the running product, captured in an incognito session
this build. That mattered more than expected:

- **`--yt-spec-*` is a dead namespace.** Of 1,469 custom properties in the
  shipped stylesheets, exactly one begins `--yt-spec-` and it resolves to
  nothing. The live system is `--yt-sys-*`.
- **Brand red is `#f03`**, and the played progress bar is a gradient — pink
  only appears near the end of a video.
- **Nothing in the app chrome transitions.** Every sampled element computes
  `transition: all 0s`; `transition-property: all` reads like animation until
  you notice the duration. The *player* is the opposite and has a real motion
  language. Conflating the two makes a clone feel wrong in both directions.
- **The home grid is 3 columns of 533px cards at 1920**, not 4 of ~360px, and
  column count follows *content* width — collapsing the guide at the same
  viewport makes it 4.
- **There are two number formatters on one page**: views round to 2 significant
  digits (`1.1M`), subscriber counts keep 3 (`7.06M`).

Icons are 37 original glyphs drawn from geometry — the captured brand-logo
paths were deliberately excluded from the research dump so they could not be
used. Roboto is Apache-2.0 and genuinely the typeface, so it ships. Every video
is synthetic, generated at seed time through the real WebCodecs path, so
seeding exercises the muxer. `pnpm seed:demo` optionally pulls Creative Commons
clips, and their attribution lives in its own column rather than in the
editable description — a licence condition must not sit in a field the uploader
can rewrite.

## The bug that 2,000 tests could not see

Next turns **every** export of a `"use client"` module into a client
*reference* — plain strings and pure functions included. A server component
that imports one and calls it throws at request time.

It happened five times: `THEME_ATTRIBUTE`, `chipsForFeed`, `historyRowMenu`,
`thumbnailSrc` and `shortHref`. The fourth alone broke ten routes.

Every instance passed the entire unit suite, because a unit test imports the
module directly and never crosses the boundary. Four also passed a route probe,
because a `<Suspense>` fallback swallowed the error in development. One passed
a probe against a *production* build too — it only failed once the database had
rows, since an empty feed never reached the call.

`src/components/__tests__/client-boundary.test.ts` checks the rule
structurally, on the TypeScript AST. Two earlier versions were worthless in
different ways.

The first followed a name to its defining module and reported *that* file's
directive, so re-exporting a value *through* a client module looked clean —
which is the exact shape that let `chipsForFeed` survive its own fix.

The second was regexes, and a review took it apart: it matched `import { a }
from` and nothing else, so a default import, `import * as x` and an
`export *` barrel were all invisible — `export *` alone would launder any
value in the codebase past it. It also decided what was dangerous from the
*name*, waving through a value called `Theme` and flagging a component called
`renderRow`.

The current one asks the question that actually matters, which the AST can
answer and a naming convention only guesses at: **is the identifier used as a
value, or only rendered as JSX?** `<Menu />` is the boundary working as
designed; `watchHref()` is the bug. It is mutation-tested against every shape
the review named — each caught, and a render-only import correctly allowed,
which is the half that shows it is not simply flagging everything.

## Running it

```bash
pnpm install
pnpm seed      # 24 clips, 533 segments, ~25s — no network
pnpm dev
```

`pnpm seed` generates its corpus by running the real encode path in headless
Chromium. That works only from a secure-context origin: on an un-navigated
page `VideoEncoder` is silently absent, which is almost certainly what every
"headless can't do WebCodecs" report actually hit. Software AVC encode then
needs zero flags. Two runs produce a **byte-identical** media tree.

| | |
|---|---|
| `pnpm dev` | the app, against PGlite and the filesystem blob store |
| `pnpm test` | 2,227 unit tests |
| `pnpm test:e2e` | 38 specs, three browser projects, production build |
| `pnpm verify` | typecheck + lint + tests |
| `pnpm seed:demo` | optional Creative Commons clips — and the way to add **your own** video ([ADDING-VIDEOS.md](ADDING-VIDEOS.md)) |

Setting `DATABASE_URL` switches to Neon; setting the R2 variables switches the
blob store. Both are one environment variable, and both refuse to boot in
production against the local adapters, because a filesystem that does not
survive the invocation that wrote to it is not storage.

## What is deliberately not built

**Live streaming.** `src/ports/live-ingest.ts` writes the interface out at the
size it would really need, with no adapter and no factory, so nothing can be
written against it by accident. WebRTC/WHIP ingest needs ICE, DTLS-SRTP and RTP
depayloading before a byte reaches storage; LL-HLS output needs partial
segments and blocking playlist reloads on top of the VOD packager. Either half
is comparable in size to three VOD slices. The finding the port records is that
live would reuse the storage and playback halves unchanged — only ingest is new.

## What the review changed

Four codex passes over the finished build returned seventy findings. The ones
worth repeating are not the bugs — they are the shapes.

**A comment defending a decision is not the decision being right.** The
reactions route explained at length why it need not check that a comment
belongs to the video in its path; the argument assumed every video's page is
reachable, which is false for a private one. The demuxer explained why not
applying edit lists was defensible for a transcoder — and no caller ever read
the field it published instead, so every AAC track's priming delay was
silently dropped. `session.ts` predicted, in a comment, the exact failure that
`Secure` on http would cause, and then set `Secure` from `NODE_ENV`, which is
true for a production build on `http://localhost`.

**Tests can name the property they do not check.** The rewatch-normaliser test
compared `relatedness()` against the identical call. The atomic-write test
asserted no `.part` file remained, which a non-atomic write also satisfies —
and when rewritten to observe a write in progress it *still* could not fail,
because `put` buffered the whole body first. The cookie tests asserted the
environment flag rather than the scheme. Each was guarding the exact bug that
was found.

**One absence can present as several.** "Subscribe does not persist", "no
watch event is recorded" and "upload needs an owner" were recorded as three
gaps. There was no sign-in route: `verifyCredentials`, `createSession` and
`sessionCookie` were all written and tested, and nothing called any of them.

The e2e suite found three bugs on its first real run, including the one that
took longest: `database()` was memoised on a module binding, and Next compiles
server components and route handlers into separate module graphs, so the
sign-in route wrote its session into one in-memory database and the layout
rendering the masthead read from another. Signing in returned 200 with a valid
cookie, every API call authenticated with it, and every page said "Sign in".

## The cookie that five features were waiting on

`recordWatch`, `recordWatchProgress` and `recordView` were written, tested, and
called by nothing. So the red resume bar never appeared, Continue watching was
always empty, history showed only the seed, every view count was frozen, and
the recommender could not learn anything from anyone using the application.

That looked like five gaps and was one. Nothing issued a session key, so four
pages fell back to `sessionKey: token ?? "anonymous"` — **one grouping bucket
for every signed-out visitor on the planet**. It was harmless only because
nothing wrote to the graph; the moment anything did, every video would
co-visit with every other one, and the recommender would confidently relate a
chess opening to a cake recipe.

The fix implements research §1.1's sessionisation rule with two different
mechanisms, which is the part worth stealing: **the 30-minute idle gap is the
cookie's `Max-Age`, rewritten on every response**, so the browser is the timer
and there is no clock comparison anywhere. **The 24-hour cap is the issue time
carried inside the value**, because a rolling `Max-Age` never expires for
someone who never idles — §1.1's "videos left playing in a background tab for a
week".

The three writes then run on three different schedules. Progress on every
report; the watch event and the view **once per session per video**, because
the watch event is a transaction that rebuilds neighbour lists and running it
per tick is a hundred and twenty graph refreshes for one ten-minute video.

## What the fifth review round found

The four rounds above reviewed the finished build; a fifth reviewed the fixes,
and the two worst findings were both in code written to close a gap.

**A guard that meant the opposite of what it said.** Both database adapters
refuse to nest transactions, and each held the flag on the adapter instance —
but `database()` is memoised process-wide, so the flag meant *"somebody in this
process is in a transaction"*, not *"this caller is"*. Two unrelated viewers
whose requests overlapped by a millisecond were diagnosed as a nesting bug and
the second was refused. It had been survivable while transactions were rare, and
the new watch endpoint made it ordinary traffic. The fix is `AsyncLocalStorage`,
which scopes the flag to the async call chain — so nesting is still caught, and
concurrency is not. The test that existed could not have found it, because a
nesting test is necessarily sequential.

**A defence reading the attacker's number.** The watch route took
`durationSeconds` from the request body, so `{"watchedSeconds":0.5,
"durationSeconds":1}` bought a view of a ten-minute video — and the guard that
capped a claim "at the video's own length" capped it at the length the request
had just supplied. The test for that guard passed `600` from both the database
and the request, so it could not tell a route that read the database from one
that read the body. Every duration in those tests is now deliberately wrong.

## Known gaps

Recorded because a replica that hides its seams is less useful than one that
names them:

- **HEVC codec strings are unverified** against real footage — transcribed from
  the standard, and the first thing to doubt if an iPhone file is rejected.
- **Nested transactions are described by the port and implemented by neither
  adapter.** No caller nests today.
- **Four features are absent rather than broken**, and each renders as a
  disabled control carrying the reason rather than a button that does nothing:
  offline Download, notifications, voice search, and the Shorts Remix editor.
  [SPEC.md](SPEC.md) §11 says what each would need.
- **Clearing history does not unlearn the recommender**, and cannot: the graph
  is keyed on the viewing cookie rather than an identity, and its counters are
  aggregates many sessions contributed to. Undoing one viewer's share would
  mean storing who contributed what — a more detailed record of viewing than
  the one being deleted.

---

Next.js · 2,227 unit tests and 38 e2e specs across three browser projects · a
23-table schema applying idempotently on PostgreSQL 18.3 · a hand-written fMP4
muxer reproducing an independently generated reference box for box · built
from nine parallel research lanes, then twelve parallel build slices, then
four rounds of review.

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Adding videos](ADDING-VIDEOS.md) · [Research](research)
