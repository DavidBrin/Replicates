# SPEC

What this application is, what each part promises, and where the boundaries
are. [DECISIONS.md](DECISIONS.md) records *why* the shape is what it is;
[README.md](README.md) is the tour. This is the contract.

---

## 1. The thesis

**The uploader's browser produces every rendition; the server never opens a
codec.**

Transcoding is the largest cost a video platform carries and it scales with
uploads rather than with revenue. Moving it into the page removes it — not
reduces it. There is no transcode queue, no worker pool, no job-retry
semantics and no backlog, because there is no transcode.

What the server does on the media path is accept opaque byte ranges and hand
them back.

## 2. Scope

| In | Out |
|---|---|
| Upload, in-browser transcode to an HLS ladder | Live streaming (`ports/live-ingest.ts`, no adapter) |
| Adaptive playback, hand-rolled ABR | Monetisation beyond an ad-provider stub |
| Channels, subscriptions, playlists | Multi-language UI |
| Threaded comments, reactions | Moderation queues, appeals |
| Search with filters and suggestions | Notifications delivery |
| Co-visitation recommender | Memberships, Super Thanks |
| Watch history and resume | |
| Shorts | |
| Captions, including a speech-recogniser port | |
| Content ID by audio fingerprint | |

## 3. The media pipeline

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

No `ffmpeg.wasm`, no `mp4box.js`, no `hls.js`, no `mux.js`.

**Guarantees.**

- The demuxer accepts a `ByteSource`, never an `ArrayBuffer`: a gigabyte
  upload is read in bounded runs. It locates `moov` by walking, never by
  position, because everything a camera writes has it last.
- Sample timestamps are **presentation** times in decode order, with the
  composition offset carried alongside, which is what makes
  demux → decode → encode → mux lossless in time.
- Edit lists are **applied** where they reduce to an offset and a trim, and
  reported unapplied where they describe a genuine multi-segment timeline.
- The muxer emits version-1 headers when a 32-bit field would overflow, and
  refuses a value that indicates the wrong timescale rather than wrapping it.
- The player's ABR estimates throughput from **video** downloads only; a
  16 KiB audio segment measures latency, not bandwidth.

**Limits, stated.** HEVC codec strings are transcribed from the standard and
unverified against real footage. The fingerprinter does not survive pitch
shift, time stretch or speed change.

## 4. Ports and adapters

Every external dependency sits behind a port in `src/ports/`.

| Port | Development | Production |
|---|---|---|
| `SqlDatabase` | PGlite (Postgres 18.3 in WASM) | Neon |
| `BlobStore` | filesystem | Cloudflare R2 |
| `SearchIndex` | Postgres `tsvector` | the same |
| `AdProvider` | stub | — |
| `SpeechRecogniser` | stub | — |
| `LiveIngest` | **no adapter, deliberately** | — |

Selection is one environment variable per port. Both local adapters refuse to
boot in production, because a filesystem that does not survive the invocation
that wrote to it is not storage.

**A port's two adapters must agree.** The divergence that shipped —
`list(prefix)` treating a prefix as a directory locally and lexically on R2 —
is the shape to watch for: not a crash, but two answers to one question, with
the disagreement visible only where there is no debugger.

## 5. Data

23 tables. `src/adapters/db/schema.sql` is the source of truth and is
generated into a TypeScript module at build time, because a `.sql` file cannot
be read at runtime under Turbopack or traced into a serverless bundle.

**Rules the schema enforces rather than the application:**

- one default caption per video;
- one live claim per (video, reference);
- one system playlist per (owner, kind);
- `video_a < video_b` on every co-visitation pair.

**Ordering is total.** Every index that serves a `LIMIT` carries an `id`
tiebreaker. PGlite's `now()` resolves to the millisecond where real Postgres
resolves to the microsecond, so a timestamp-only order is a sampler locally
and a total order deployed — a test that passes in production and flakes on a
laptop, which is the direction that gets assertions weakened instead of bugs
fixed.

## 6. The recommender

Co-visitation after Davidson et al., RecSys 2010
([10.1145/1864708.1864770](https://doi.org/10.1145/1864708.1864770)).

`r(vi,vj) = cij / (ci·cj)` — **both** session counts. The paper notes ci is
constant within one seed's candidates and may be dropped; that is true for
ranking one seed and false here, because `aggregateAcrossSeeds` sums a
candidate's scores across every seed that reached it, and two seeds' scores
have to share a scale before they can be added.

`cij` counts **distinct sessions containing both**, so a viewer replaying one
video contributes once. `ci` is a distinct-session count, never
`videos.view_count`; the two diverge the moment anyone rewatches.

## 7. Content ID

Landmark audio fingerprinting after Wang, ISMIR 2003: STFT, a spectral peak
constellation, combinatorial hashing of `(f1, f2, Δt)`, and a match declared
by a spike in the histogram of time-offset differences. It runs in the Worker
pass already decoding audio for transcoding, so matching costs the server
nothing.

The threshold is **derived**: 3,086 leave-one-out non-matching pairs, a
false-positive distribution characterised to p99.9 with a maximum observed
coincidence of 204, and an exponential tail placing the shipped threshold of
250 at roughly 2.5 × 10⁻⁵ per pair.

Hash fields are **range-checked, not masked**. A mask makes two distinct
triples collide silently, and a false match is the worst outcome this module
has, because the threshold was derived assuming distinct triples stay
distinct.

## 8. Security

- **Durations are read from the database, never from the request.** The watch
  reporter knows how long a video is, so sending it looked natural — and it made
  view inflation two lines, because the threshold *and* the "cap the claim at
  the video's own length" guard were both reading the attacker's number.
- **State-changing routes check the request's origin.** `SameSite=Lax` stops a
  cross-site POST *carrying* a cookie; it does not stop the request being
  delivered or its response's `Set-Cookie` being applied, which is enough to
  switch off a visitor's watch history from any page on the internet.
- **Media types are derived from the key, never accepted from the client.**
  Every blob is served from this origin, so the `Content-Type` is an
  instruction about what to *do* with the bytes. `X-Content-Type-Options:
  nosniff` on every media response.
- **Authenticated is not authorised.** Every route that acts on a video by id
  resolves it through `authorizeVideoAccess`, which collapses "not yours" into
  the same 404 as "no such video" — a 403 confirms the id names something.
- **Private media is `no-store`.** A cached response is the one path where a
  correct authorisation check is never consulted.
- **`Secure` follows the request's scheme**, not `NODE_ENV`: a production
  build served over http is a real configuration, and it is the one the e2e
  suite runs.
- Sessions are a signed JWT **and** a row. The JWT gives the cookie integrity;
  the row gives revocation.

## 9. What "done" means here

`pnpm verify` — typecheck, lint, and 2,227 unit tests — plus `pnpm test:e2e`,
38 specs across three browser projects against a production build.

**A test that has never failed is not evidence.** Structural checks and
regression tests in this repository are mutation-tested: the bug is
reintroduced, the test is confirmed to fail, and only then is it kept. Where
a test *cannot* be made to discriminate, that is recorded next to it rather
than left to look like coverage.

## 10. Sessionisation

The viewing session key is a cookie (`yt_vk`), issued by `src/proxy.ts`,
and it implements `research/04` §1.1's rule with two different mechanisms:

- **the 30-minute idle gap is the cookie's `Max-Age`**, rewritten on every
  response, so the browser is the timer and no clock comparison is needed;
- **the 24-hour cap is the issue time carried inside the value**, because a
  rolling `Max-Age` never expires for someone who never idles — §1.1's
  "background tab for a week".

It confers no authority and names no user. What it must not be is
guessable in bulk, since a collision merges two strangers' viewing into one
session, so it is 128 bits from the platform CSPRNG.

Three writes hang off it, on three different schedules. Progress on every
report; the watch event and the view **once per session per video**, gated by
`sessionHasLoggedWatch` — the alternative is a hundred and twenty views and a
hundred and twenty graph refreshes for one ten-minute video.

That gate asks the **event log**, not the membership table, and the difference
is a privacy control working or not: `clearHistory` deletes the log and cannot
delete the membership rows, which are keyed on the cookie and back counters
other sessions contributed to. Gated on membership, clearing your history made
every video you had watched unrecordable until the cookie rotated.

The view and the graph commit in **one transaction**, because two writes with a
gap between them can leave the membership row committed and the counter not —
and that state is permanent, since every retry then sees the session has
already watched the video.

## 11. Known gaps

- **HEVC codec strings are unverified** against real footage.
- The PGlite and Neon adapters **do not implement nested transactions** the
  way `SqlDatabase` describes them; no caller nests today.
- **The history page groups in UTC**, not the viewer's zone. The zone is a
  client fact and no cookie carries it.
- **Four surfaces are absent rather than broken**, and each renders as a
  disabled control carrying the reason: offline **Download** (needs a storage
  quota, a background fetch and an eviction policy), **Notifications** (a
  notification is an event with a read state; there is no such table), **voice
  search** (`SpeechRecogniser` has a stub adapter only), and Shorts **Remix**
  (the Shorts editor is a creation surface this build does not have). A
  pressable control that did nothing would teach a visitor the application is
  broken rather than that the feature is absent.
- **Clearing history does not unlearn the co-visitation graph.** It cannot: the
  graph is keyed on the viewing cookie rather than on an identity, and its
  counters are aggregates many sessions contributed to. Decrementing one
  viewer's share would mean storing who contributed what — a *more* detailed
  record of viewing than the one being deleted. See `clearHistory`.
