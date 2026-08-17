# Decisions

Numbered, dated, and honest about what was measured versus assumed. Each entry
records the alternative that was rejected, because that is the part that is
expensive to reconstruct later.

Entries citing `research/` point at a document written this run from primary
sources — the ISO BMFF standard text, RFC 8216 and 9110, Wang's ISMIR 2003
paper, Davidson et al. RecSys 2010 — rather than from recollection.

---

### D1 — The uploader's browser does the transcoding

**Rejected:** server-side transcode, the way every real video platform works.

Transcoding is the most brutal cost a video platform carries, and it scales
with uploads rather than with revenue. Encoding the rendition ladder in the
uploader's browser with WebCodecs moves that cost to the one machine that is
already idle and already holds the source file. The server stores ready-made
segments and never opens a codec, so cost per upload is approximately zero
regardless of volume.

What this buys is not merely cheapness — it is that the expensive part of the
system does not exist. There is no transcode queue, no worker pool, no
job-retry semantics, no backlog to monitor.

**What it costs:** two upload paths instead of one (see D3), and a hard
dependency on a browser API that not everyone has.

**Never `ffmpeg.wasm`.** It is the obvious alternative and it is a trap: no GPU
access from WASM, and roughly an order of magnitude slower than native at 720p.
The direction of that gap is well documented; the specific figures in
circulation could not be verified and are not relied on here
(`research/01-webcodecs-encode.md` §8).

### D2 — Safari did not close the WebCodecs gap in version 26

**Corrected during research.** The brief this project was built from stated
that Safari 26 closed the last coverage gap for WebCodecs video encoding. That
is wrong in a way worth recording, because it was wrong in our favour.

Safari has shipped an H.264 `VideoEncoder` since **16.4, in 2023**. What Safari
26 added was `AudioEncoder` and `AudioDecoder`. So video encode coverage has
been broad for considerably longer than assumed, and what was new is the audio
half — which this project also needs, but which is a smaller gap than the one
we thought we were designing around (`research/01-webcodecs-encode.md` §3.3).

### D3 — The no-WebCodecs path is a second, structurally different application

Roughly one browser in twenty cannot encode in the page. Those uploads store
the source file untouched and serve it whole over HTTP `Range` as a single
progressive rendition.

This is not a degraded version of the main path; it is a different one. A
different upload transport, a different storage layout, a different player, no
ladder and no quality menu. `videos.pipeline` records which produced a given
video and the player branches on it, so the column is load-bearing rather than
diagnostic.

**It gets its own e2e project**, because nothing in a normal run exercises it
and it would otherwise rot silently. Rather than chase a real browser that
lacks the API, the Playwright project deletes the WebCodecs constructors before
any page script runs, so feature detection genuinely fails and the application
takes the fallback in earnest.

### D4 — The muxer is hand-written, and it is the first thing built

**Rejected:** `mux.js`, `mp4box.js`.

`VideoEncoder` yields an `EncodedVideoChunk` — a bare bitstream with a
timestamp. It is not a container and not anything a browser can play.
Everything between that and a playable HLS rendition is ours: `ftyp`, `moov`,
`moof`, `mdat`, written by hand. The sibling project `fake-phone` hand-writes a
RIFF/WAVE container for the same reason, and this repository's convention is
that the interesting part should not be a dependency.

It is built first and alone, because every slice downstream consumes its output
format.

**The muxer is typed against plain structs, not WebCodecs types**
(`src/media/types.ts`). `EncodedVideoChunk` cannot be constructed in Node, so a
muxer typed against it could only ever be tested in a browser. Typed against a
struct, it is driven from synthetic samples and its output parsed back and
asserted field by field.

### D5 — `trun.data_offset` is computed, not back-patched

Real muxers write a placeholder into `trun.data_offset`, serialise `moof`,
then seek back and rewrite the field once `mdat`'s position is known.

That is unnecessary. A fragment's sample table is fully known before `moof` is
serialised, so `moof`'s size — and therefore the offset to `mdat`'s payload —
can be computed analytically in a single forward-only pass. No seeking, no
mutable buffer, no placeholder that a future edit might forget to patch
(`research/02-fmp4-hls-packaging.md`).

### D6 — Three findings that make an fMP4 silently unplayable

Recorded because each produces output that looks structurally fine and does not
play, and each cost real time to establish:

1. **`tfdt` is mandatory.** Core ISO BMFF makes it optional. MSE's byte stream
   format spec makes its absence an append error on every `traf`. The two specs
   layer, and only the stricter one is observable at runtime.
2. **`tkhd.duration` is in the movie timescale**, not the track's own. Every
   other duration field nearby is in the track timescale, which makes this the
   natural place to introduce a drift that is inaudible for a minute.
3. **`mvex`/`trex` must be present** or a fragmented file is read as having no
   samples at all and plays as zero-length.

### D7 — Codecs are negotiated at runtime, not assumed

The ladder does not assume AVC. `VideoEncoder.isConfigSupported` decides among
`avc1`, `vp09` and `av01` on the uploader's machine, and the negotiated string
is stored per rendition — the muxer needs it for the sample entry and the
packager for the HLS `CODECS` attribute, and neither can derive it.

This is why `video_renditions.codec` is a stored column rather than a constant.

One constraint shapes the preference order: **VP9 is absent from Apple's
supported-codec list for native HLS**, so a VP9 ladder plays only through MSE
and not through the native fallback path (`research/02-fmp4-hls-packaging.md`).

**`av1C` cannot be synthesised.** Unlike VP9's `vpcC`, AV1's configuration
record cannot be derived from the codec string — it requires parsing a Sequence
Header OBU. It is taken from the `description` WebCodecs supplies, which is the
single most useful thing that API does for a muxer.

### D8 — Headless Chromium can encode, from a secure origin only

The seed script generates its corpus by running the real WebCodecs path in
headless Chromium, so this question gated the whole fixture layer.

**Settled by running the experiment rather than by reading reports.**
`VideoEncoder` is exposed in headless Chromium, including
`chromium-headless-shell` — but only once the page is served from a
secure-context origin. On an un-navigated `about:blank` page it is silently
absent, which is almost certainly what the "headless doesn't support WebCodecs"
reports actually hit. Software AVC encode then works with zero flags; hardware
encode needs `--enable-gpu` (`research/01-webcodecs-encode.md` §4).

**Verified on macOS only.** A Linux CI runner needs its own pass.

### D9 — The player is ours: MSE, our own HLS parser, our own ABR

**Rejected:** `hls.js`.

`hls.js` is battle-tested and would have been the cheaper choice. The argument
against it is that we generate every manifest and every segment, so our parser
only has to read what our own packager emits — a small corner of RFC 8216
rather than the whole of it — and the most interesting third of the pipeline
stays ours end to end.

ABR blends a throughput EWMA with a buffer-level floor that can veto an
upswitch. The constants come from what shipping players actually use
(`research/03-mse-player-abr.md` §6) rather than from a paper's idealisation,
and they are named and tunable because the right values depend on a deployment
we do not control.

### D10 — Safari's Managed Media Source needs `disableRemotePlayback`

On Safari, `ManagedMediaSource` will not fire `sourceopen` at all unless
AirPlay is gated off with `disableRemotePlayback`. This is essentially
undocumented and presents as a player that attaches, reports no error, and
never begins buffering (`research/03-mse-player-abr.md` §2).

### D11 — Co-visitation, and two ways to get it quietly wrong

The recommender is co-visitation after Davidson et al., RecSys 2010
(doi 10.1145/1864708.1864770). Not a small-scale substitute — this is what
YouTube actually ran.

The paper's headline is **207% of a most-viewed baseline**, and the number is
narrower than it is usually quoted: it is click-through rate on **browse
pages**, measured over 21 days, deliberately not the home page because of
presentation bias.

Two defects were caught in this project's own first schema, both of which
produce recommendations that look entirely plausible while being wrong:

1. **The normaliser is a distinct-session count, not a view count.** The
   paper's `f(vi,vj) = ci·cj` counts sessions containing each video. The first
   draft normalised against `videos.view_count`, which diverges the moment
   anyone rewatches anything and penalises rewatched videos for being
   rewatched. `video_session_counts` exists for this and nothing else.
2. **Co-visitation must be deduplicated within a session.** `cij` counts
   distinct sessions containing both videos. Without a membership set to test
   against, a viewer replaying one video four times re-increments every pair it
   touches, and the counts quietly become "watched together, weighted by replay
   count" — which inflates exactly the popular pairs the recommender leans on
   hardest. `session_videos` is that membership set.

**Write and read shapes are deliberately opposite.** `covisitation` is
canonicalised (`video_a < video_b`, enforced) so a pair is one row; the
precomputed `related_videos` is denormalised to both directions so a read is
one index scan with no union. Two shapes, because the two access patterns
genuinely disagree.

### D12 — Content ID: landmark fingerprinting

The one YouTube subsystem nobody clones, and the thing this replica does that
a replica is not expected to attempt — the equivalent of the rollback netcode
in this repository's Super Smash Bros. project.

Wang's ISMIR 2003 method: STFT, spectral peak constellation, combinatorial
hashing of (anchor, target, Δt) triples, and a match declared by a spike in the
histogram of time-offset differences. The paper never states its window and hop
sizes; the companion patent does, and the research lane read both
(`research/06-audio-fingerprinting.md`).

It runs in the Worker pass that is already decoding the audio for transcoding,
so matching costs the server nothing — the same trick as D1, applied to
copyright.

**What it cannot do:** survive pitch shift, time stretch or speed change, which
are precisely the evasions uploaders actually use. Recorded as a limit, not
papered over.

### D13 — One dialect, two engines: PGlite locally, Neon deployed

Settled by the sibling project `Linear` and not re-argued. SQLite locally and
Postgres deployed means the two engines disagree quietly — type affinity,
collation — and every such difference is a green local suite and a 500 in
production.

This project adds a third reason: search is `tsvector` and the recommender is a
self-join with a `GROUP BY` the planner has to get right. Neither has a SQLite
equivalent that would prove anything.

**PGlite ships no extensions.** `create extension` fails outright — no
`pg_trgm`, no `citext`, no `unaccent`. So search is core FTS with no trigram
fuzzy matching, and case-insensitive uniqueness is a `unique index on
(lower(...))` rather than a `citext` column. The `lower()` expression is
load-bearing in both directions: every lookup must use the same expression or
it silently misses the index *and* lets two spellings both register.

### D14 — R2 over S3, decided by arithmetic

Egress is the cost curve of a video platform, and R2 does not charge for it.

Worked at 1,000 videos of five minutes, a six-rung ladder and 10,000
views/month — 588 GB stored, 1,047 GB egress — R2 comes to roughly $8.67/month
against $17.22 for S3 + CloudFront. That gap is unremarkable. At 100× the
traffic it is roughly $24 against **$7,355**, because CloudFront's free tier
masks the real egress price at toy scale and stops doing so exactly when it
matters (`research/05-storage-and-delivery.md` §1, prices read 2026-08-16).

### D15 — Segments go straight to storage, because they have to

**The finding that reshaped the upload path:** Vercel's 4.5 MB request-body
limit is enforced at the infrastructure level, and streaming the body does
**not** bypass it. A server-proxied segment upload is therefore not merely
inefficient in production — it does not work.

So the browser PUTs segments directly to R2 on presigned URLs. But the
filesystem adapter cannot issue a signed URL at all, so development would have
no upload path if that were the only mechanism. The upload flow therefore asks
the server for an upload *target* and receives either a presigned URL or a
route-handler URL depending on the adapter.

Two transports, both real, both exercised — which is uncomfortable, and is
still better than a development path that cannot ship.

### D16 — The `BlobStore` port had two adapter-shaped bugs

Both would have worked against the filesystem and failed against R2, which is
the worst direction for a difference to run. Recorded because the port was
written before the research that caught them, which is exactly the failure mode
this repository's research-first convention exists to prevent.

1. **`list()` ignored pagination.** `ListObjectsV2` returns at most 1000 keys
   plus a continuation token. A six-rung ladder for a long video passes 1000
   segments easily, so "delete this video" would have left most of it behind —
   and the filesystem adapter, which has no such limit, would never have shown
   it.
2. **A streaming `put` carried no `Content-Length`.** A non-multipart S3
   `PutObject` requires it up front and cannot derive it from a stream it has
   not finished reading.

### D17 — Live streaming is declared and not implemented

A WebRTC/WHIP ingest needs ICE, DTLS-SRTP and RTP depayloading before a byte
reaches storage; LL-HLS output needs partial segments, blocking playlist
reloads and preload hints on top of the VOD packager. Either half is comparable
in size to three of this project's VOD slices.

`src/ports/live-ingest.ts` writes the interface out at the size it would really
need, because a port with no adapter is a claim about feasibility and an empty
file would be an unbacked one. The finding it records is that live would reuse
the storage and playback halves unchanged — only ingest is genuinely new.

**There is deliberately no factory.** A caller cannot obtain an adapter, so
nothing can be written against this port by accident and later discovered to be
dead code.

### D19 — Two engine differences that only fail in one direction

Both were measured during the build, and both share a shape: the local engine
is more permissive than the deployed one, so the test suite is green and the
deployment is broken.

**PGlite's `now()` resolves to milliseconds.** The microsecond field of a
`timestamptz` it generates is always zero; real Postgres fills it. Rows
inserted in one batch therefore share a timestamp locally and do not on Neon,
which makes `order by published_at desc` an arbitrary order in development and
a total one in production.

That asymmetry is worse than a plain bug. A feed test asserting an exact order
passes against Neon and flakes locally, so the natural conclusion is that the
local engine is at fault and the assertion gets weakened — deleting the only
check that would have caught a real ordering regression later. Every ordering
index in the schema therefore ends in a unique column, and every `order by`
must match its index exactly, tiebreaker included.

**Canonical pair ordering must happen in SQL, not in TypeScript.** JavaScript's
`<` compares UTF-16 code units; Postgres compares by the column's collation,
and the two disagree on case. Video ids are mixed-case base62 and `covisitation`
carries `check (video_a < video_b)`, so canonicalising in application code
passes under PGlite — whose default collation is byte-wise — and would reject
rows against Neon. The insert uses `least`/`greatest` in the same statement as
the constraint, so the two cannot disagree about what "less than" means.

This is the sibling project `Linear`'s D3 trap resurfacing in a new place,
which suggests it is a property of the stack rather than of that schema.

### D20 — The zero-config promise is only kept if something tests it

`pnpm install && pnpm dev` against an empty environment is the promise this
project inherits from its siblings, and it was broken for most of the build
without anyone noticing.

PGlite's node backend calls a plain `mkdirSync` rather than a recursive one, so
a `dataDir` whose parent is missing fails with `ENOENT` before a single
statement runs. The default is `.data/db`, and `.data` is gitignored — which is
the state of every fresh clone.

It stayed invisible for two compounding reasons. Every unit suite uses
`:memory:`, so nothing exercised the persistent path at all; and the machine
that first ran it had a `.data` directory left from an earlier experiment. It
finally surfaced as thirty-two apparently unrelated route tests failing at once
on a clean tree.

The fix is one `mkdir` with `recursive: true`. The lesson is that a promise
about a *fresh* environment cannot be verified from a *working* one, and the
e2e suite — which builds and boots from clean — is the only thing in this
project that genuinely checks it.

### D18 — Nothing in the repository is a YouTube asset

The sibling project `super-smash` draws every fighter from code because there
is no legitimate way to obtain Nintendo's art. The same rule applies here and
is easier to keep.

Layout values — spacing, type scale, grid breakpoints, control geometry — are
measured from the running product, because measurement is the only way to get
them right; the sibling `Linear` project found that almost every hex value in
circulation for that app belonged to its marketing site rather than to the app
itself. Those measurements are facts about a layout and they live in
`research/`.

Icons are drawn as original SVG paths from geometric description. Roboto is
Apache-2.0 licensed and is genuinely the typeface in use, so it ships. Video
and thumbnails are synthetic, generated at seed time through the real WebCodecs
path — so seeding exercises the muxer — or optionally Creative Commons via
`pnpm seed:demo`, which is for screenshots and never gates a test.

Screenshots of the **signed-in** application are gitignored. What was extracted
from them — token values, type scale, row geometry — survives in `research/`,
because a measurement table can be sanitised and a screenshot cannot.
