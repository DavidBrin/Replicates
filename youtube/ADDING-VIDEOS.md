# Adding videos

How to put your own footage into this library, and how the home page decides
what to show. Written for the case of standing the project up in a portfolio,
where the seeded corpus is the wrong content and the first screenshot is the
whole pitch.

---

## What the home page actually does

Two rules, and neither is "newest first".

**A video is eligible** when all three of these are true — `PUBLIC_AND_READY`
in `src/adapters/repositories/recommendations.ts`:

```sql
visibility = 'public' and upload_status = 'ready' and published_at is not null
```

`publishVideo` sets the last two. A video that never went through it is
invisible everywhere, including search, and looks like a bug.

**The order is co-visitation first, then a backfill.** `homeFeed` asks the
recommender for videos related to what this viewer has watched, and fills the
rest of the page from a pool ordered:

```sql
order by view_count desc, published_at desc, id desc
```

So on a fresh browser with no watch history — which is every visitor to a
portfolio — **the home grid is that pool, ordered by view count**. A video you
have just added has zero views and lands last, behind every seeded one: the
corpus draws its counts from a Zipf distribution, so the top video sits near a
million and even the tail is in the thousands. That is the single thing that
catches people out, and every route below says what to do about it.

The first row of the page is the Shorts shelf, which is a separate query
(`shortsFeed`) over vertical videos and is ordered **newest first**. A vertical
video therefore leads that shelf the moment it is added, with no view count
needed.

---

## Route 1 — your own file, on the home page (recommended)

`pnpm seed:demo` was built to add real Creative Commons films, and it takes any
file you point it at. It stores the video whole and serves it over HTTP `Range`
on the **progressive** pipeline, because re-encoding a finished file into an HLS
ladder needs a demuxer this project does not carry (`research/01` §9.2). That is
a real playback path and the player uses it.

**1. Put the file where the cache lives.** The fetch is cache-first, so a file
already sitting there is used and no request is made:

```
public/demo-media/<key>.<extension>
```

`public/demo-media/` is gitignored. `<key>` is yours to choose and `<extension>`
must be `mp4` or `webm` — anything else is stored with the wrong content type.

**2. Add an entry to `ASSETS` in `scripts/seed-demo.ts`:**

```ts
{
  key: "showreel-2026",          // must match the filename
  title: "Showreel 2026",
  synopsis: "One paragraph, rendered as the description.",
  attribution: "Your Name",      // rendered under the description
  licence: "All rights reserved",
  licenceUrl: "https://your.site/",
  sourcePage: "https://your.site/",
  tags: ["showreel", "portfolio"],
  category: "Film & Animation",
  palette: ["#0d1408", "#e8f5c8", "#84cc16"],  // the generated title card
  urls: [],                      // empty: the cached file is already there
  extension: "mp4",
  width: 1920,
  height: 1080,
  durationSeconds: 96,           // must be the real length — see below
  megabytes: 24,                 // approximate; only feeds the size budget
  viewCount: 2_400_000,          // where it lands on the grid
},
```

**3. Run it:**

```bash
pnpm seed:demo                 # or --limit=1 while you iterate
```

Everything lands on a channel called **Open Cinema** (`@opencinema`). If you
want it on a channel of your own, change `DEMO_CHANNEL` in the same file.

### The fields that matter, and why

- **`viewCount`** is what puts you at the top of the grid. It is the only reason
  this field exists: `videos.view_count` has no repository setter, deliberately —
  `updateVideo`'s column map omits it so that `{ view_count: 1e9 }` arriving in a
  request body cannot reach the column — so the script stamps it with one SQL
  statement, exactly as `stampCorpusFacts` does for the synthetic corpus. Omit it
  and you get 0 and last place.
- **`durationSeconds` must be true.** It is written to the row and the player's
  scrubber, the progress bar and the "counts as a view" threshold all read it. A
  row claiming 8:32 over ninety seconds of media is a player bug wearing a
  plausible number.
- **`width`/`height` decide whether it is a Short.** `publishVideo` derives
  `is_short` from "square or taller **and** ≤ 180 seconds". A 1080×1920 clip
  under three minutes goes to the Shorts shelf — newest first, no view count
  needed — and is filtered *out* of the main grid.
- **The thumbnail is a generated title card, not a frame from your video.**
  Pulling a still out of a finished container needs the demuxer this project does
  not have, and a placeholder pretending otherwise would be the one dishonest
  pixel in the corpus. `palette` is what it is drawn from.
- **`urls` may be empty** when the file is already cached. It is a list because
  the canonical host for the bundled films is not always reachable; for your own
  file there is nothing to fetch.

### Re-running

The script skips a video whose id already exists, and the id is derived from
`key` — so **editing a title and re-running changes nothing**. To replace a
video, either use a new `key` or delete `.data/` and start again:

```bash
rm -rf .data && pnpm seed && pnpm seed:demo
```

---

## Route 2 — upload through the UI, like a user

`/studio/upload`, signed in. This is the real product path and the only one that
exercises the whole thesis: your browser demuxes the file, decodes it once, fans
the frames out to several `VideoEncoder`s, muxes fMP4 with the hand-written
muxer and uploads an HLS ladder. The server never opens a codec.

Use this to **demonstrate the pipeline**, not to dress the home page. It gives
the video zero views, so it sorts last — and there is no UI anywhere that sets a
view count, on purpose.

Sign in with the account the seed prints:

```
lumendesk@seed.invalid / seed-corpus-password-2026
```

It works with an `.mp4` your browser can decode. If a file is rejected, the first
thing to doubt is its codec string — HEVC support is transcribed from the
standard and unverified against real footage, which `SPEC.md` §11 lists as a
known gap.

---

## Route 3 — more of the synthetic corpus

`scripts/seed/corpus.ts` holds `VIDEO_SOURCE`, the twenty-four videos `pnpm seed`
generates. Adding an entry there produces a **generated** clip — a moving
gradient, a waveform, an orbit — encoded through the real WebCodecs path at seed
time. Use it to grow the library, not to show your own work: there is no way to
hand it a file.

Two things the corpus enforces, both of which fail loudly rather than silently:

- Captions in `CAPTIONED` are keyed by **title**. A typo throws at build time
  rather than producing a corpus with no captions and no complaint.
- Every cue must lie inside its clip's duration, and no two cues of one track may
  overlap. `scripts/seed/__tests__/corpus.test.ts` checks both.

---

## Removing a video

`/studio` can discard an upload that **never finished**, and deliberately
refuses a published one — the Server Action returns early on
`uploadStatus === "ready"`, because sweeping a published video's objects out of
storage is a heavier operation than dropping an unfinished row, and neither this
action nor `/api/videos` pretends otherwise. `deleteVideo` drops the row and
`blobKeys.videoPrefix(id)` names everything belonging to it in the blob store,
which is what a real delete would have to walk.

So for a published video, the blunt instrument is the only one:

```bash
rm -rf .data && pnpm seed
```

`.data/` holds both the Postgres directory and the blob tree, and the corpus is
deterministic — the same ids, dates and view counts come back every time.

---

## A checklist for standing this up in a portfolio

```bash
pnpm install
pnpm seed                    # 24 clips, 533 segments, 5 caption tracks, ~25s
# add your file to public/demo-media/ and an ASSETS entry with a viewCount
pnpm seed:demo
pnpm dev                     # http://localhost:3000
```

Worth knowing before someone else clicks around:

- **Sign in first.** Subscribing, liking, saving to a playlist and clearing
  history all need an account, and each sends you to `/signin` rather than
  failing silently.
- **Views only move once per session per video**, and only after 30 seconds — or
  half the video, whichever is smaller, which is what lets a Short count at all.
  Reloading will not inflate anything.
- **Four controls are deliberately greyed**, with the reason in a tooltip:
  Download, notifications, voice search, and Shorts Remix. They are features this
  build does not have rather than buttons that are broken. `SPEC.md` §11 says
  what each would need.
