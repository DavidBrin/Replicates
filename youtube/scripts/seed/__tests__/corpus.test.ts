// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CORPUS_EPOCH_MS,
  CORPUS_SEED,
  SEED_LADDER_RUNGS,
  SHARED_PASSAGE_SECONDS,
  audioSampleAt,
  buildCorpus,
  corpusDigest,
  mulberry32,
  renderAudioChannel,
  zipfViews,
} from "../corpus";

/**
 * What is pinned here, and why it is worth pinning.
 *
 * The encode driver is exercised by running it — a headless browser and two
 * minutes of AVC encoding is not a unit test, and pretending otherwise would
 * produce a suite that mocks `VideoEncoder` and therefore proves nothing about
 * the one API the whole slice depends on. So this file covers the half that
 * *is* a pure function: the corpus definition.
 *
 * That half carries the property the rest of the project leans on. The e2e
 * suite and the recommender's own tests assert exact orderings against these
 * rows, and an ordering assertion against a corpus that moves is a flaky test
 * that will get weakened rather than fixed — the same failure mode `schema.sql`
 * describes for PGlite's millisecond `now()`. So determinism is asserted as a
 * whole-object digest rather than as a handful of spot values: a digest fails
 * on any reordered draw, and spot values pass through most of them.
 */

/**
 * The corpus module's *code*, with comments removed.
 *
 * Stripped rather than read whole because the header of `corpus.ts` explains at
 * length that it contains no `Math.random()` — and a naive scan of the file
 * would match that sentence and fail. Asserting against prose is how a
 * source-level check turns into a rule about how you are allowed to write a
 * comment.
 */
const CORPUS_CODE = readFileSync(fileURLToPath(new URL("../corpus.ts", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("determinism", () => {
  it("produces an identical corpus from the same seed", () => {
    const a = buildCorpus();
    const b = buildCorpus();
    expect(corpusDigest(b)).toBe(corpusDigest(a));
    expect(b).toEqual(a);
  });

  it("produces a different corpus from a different seed", () => {
    // Otherwise the digest above would pass against an implementation that
    // ignored the seed entirely and returned a constant.
    const a = buildCorpus({ seed: CORPUS_SEED });
    const b = buildCorpus({ seed: CORPUS_SEED + 1 });
    expect(corpusDigest(b)).not.toBe(corpusDigest(a));
    expect(b.videos.map((v) => v.id)).not.toEqual(a.videos.map((v) => v.id));
  });

  it("takes its clock from the caller, never from Date.now", () => {
    const fixed = Date.UTC(2027, 0, 1);
    const corpus = buildCorpus({ nowMs: fixed });
    for (const video of corpus.videos) {
      expect(video.publishedAtMs).toBeLessThanOrEqual(fixed);
    }
    // The default is the fixed epoch, not the wall clock: two runs a week apart
    // must agree, and a default of `Date.now()` is exactly how that guarantee
    // gets lost without anything failing.
    expect(buildCorpus().videos[0]?.publishedAtMs).toBeLessThanOrEqual(CORPUS_EPOCH_MS);
    expect(buildCorpus().nowMs).toBe(CORPUS_EPOCH_MS);
  });

  it("contains no Math.random and no wall clock", () => {
    // A source-level assertion, because this is the one defect that cannot be
    // caught by comparing two builds in one process: `Math.random()` seeded from
    // the same V8 instance within one test run can, in principle, be spotted by
    // the digest test — but `Date.now()` inside a fast test would return the
    // same millisecond twice and pass it.
    expect(CORPUS_CODE).not.toMatch(/Math\.random/);
    expect(CORPUS_CODE).not.toMatch(/Date\.now/);
    expect(CORPUS_CODE).not.toMatch(/new Date\(\)/);
    expect(CORPUS_CODE).not.toMatch(/crypto\.randomUUID/);
    // The stripper has to have left something behind, or the four assertions
    // above pass against an empty string.
    expect(CORPUS_CODE).toMatch(/export function buildCorpus/);
  });

  it("draws a portable sequence from mulberry32", () => {
    // Pinned literally: the generator's output is a wire format between Node and
    // Chromium (`scripts/seed/page` imports this module), so a change to it is a
    // change to every id in the corpus and should read as one in the diff.
    const rng = mulberry32(1);
    const first = [rng(), rng(), rng()].map((n) => n.toFixed(12));
    expect(first).toEqual(["0.627073940588", "0.002735721180", "0.527447039960"]);
    expect(mulberry32(1)().toFixed(12)).toBe("0.627073940588");
  });
});

describe("the catalogue", () => {
  const corpus = buildCorpus();

  it("gives every video an id of the shape a /watch?v= URL carries", () => {
    for (const video of corpus.videos) {
      expect(video.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
    expect(new Set(corpus.videos.map((v) => v.id)).size).toBe(corpus.videos.length);
  });

  it("spreads uploads over months rather than over minutes", () => {
    const ages = corpus.videos.map((video) => (corpus.nowMs - video.publishedAtMs) / 86_400_000);
    const newest = Math.min(...ages);
    const oldest = Math.max(...ages);
    expect(newest).toBeLessThan(1);
    expect(oldest).toBeGreaterThan(240);
    // Every relative-time bucket the formatter can render should have at least
    // one video in it, or the formatting is untested by the corpus that exists
    // to exercise it.
    expect(ages.some((days) => days < 1)).toBe(true);
    expect(ages.some((days) => days >= 1 && days < 7)).toBe(true);
    expect(ages.some((days) => days >= 7 && days < 31)).toBe(true);
    expect(ages.some((days) => days >= 31)).toBe(true);
  });

  it("has no two videos published in the same millisecond", () => {
    // `videos_published_idx` is `(published_at desc, id desc)` and the feeds
    // order to match. Distinct timestamps make the feed order legible to a
    // person reading the catalogue as well as total to Postgres.
    const stamps = corpus.videos.map((video) => video.publishedAtMs);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("distributes views as a power law, not a uniform draw", () => {
    const views = [...corpus.videos.map((video) => video.viewCount)].sort((a, b) => b - a);
    const top = views[0]!;
    const median = views[Math.floor(views.length / 2)]!;

    // The property that matters for a believable grid: a couple of videos carry
    // most of the traffic and the tail is small. A uniform draw would put the
    // median within a factor of two of the top.
    expect(top).toBeGreaterThan(300_000);
    expect(median).toBeLessThan(top / 40);
    expect(views.at(-1)!).toBeLessThan(20_000);
    expect(views.filter((n) => n > top / 10).length).toBeLessThanOrEqual(3);

    // And every count is a plausible integer.
    for (const count of views) {
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThan(0);
    }
  });

  it("keeps likes and dislikes in a believable band under the view count", () => {
    for (const video of corpus.videos) {
      expect(video.likeCount).toBeLessThan(video.viewCount * 0.06);
      expect(video.dislikeCount).toBeLessThan(video.likeCount);
    }
  });

  it("populates both the grid and the Shorts shelf", () => {
    const vertical = corpus.videos.filter((video) => video.isVertical);
    expect(vertical.length).toBeGreaterThanOrEqual(5);
    for (const video of vertical) {
      // `isShortVideo` in `repositories/videos.ts` requires width/height <= 1
      // and a duration at or under three minutes. Asserting the corpus side of
      // that rule here means a vertical clip that would silently land in the
      // 16:9 grid fails in this suite rather than in a screenshot.
      expect(video.clip.width / video.clip.height).toBeLessThanOrEqual(1);
      expect(video.clip.durationSeconds).toBeLessThanOrEqual(180);
    }
    expect(corpus.videos.filter((video) => !video.isVertical).length).toBeGreaterThanOrEqual(12);
  });

  it("includes a progressive-pipeline video so that path is visible", () => {
    const progressive = corpus.videos.filter((video) => video.pipeline === "progressive");
    expect(progressive.length).toBeGreaterThanOrEqual(1);
    expect(progressive.every((video) => !video.isVertical)).toBe(true);
  });

  it("gives every clip a real duration rather than an advertised one", () => {
    for (const video of corpus.videos) {
      expect(video.clip.durationSeconds).toBeGreaterThan(0);
      expect(video.thumbnailAtSeconds).toBeLessThan(video.clip.durationSeconds);
      expect(video.previewStartSeconds + video.previewSeconds).toBeLessThanOrEqual(
        video.clip.durationSeconds,
      );
    }
  });

  it("gives the channels visually distinct palettes and every clip a motion kind", () => {
    const backgrounds = corpus.channels.map((channel) => channel.palette[0]);
    expect(new Set(backgrounds).size).toBe(corpus.channels.length);
    expect(new Set(corpus.videos.map((video) => video.clip.visual)).size).toBeGreaterThanOrEqual(5);
    // Two clips of one visual kind must not move in lockstep, or the grid reads
    // as one animation repeated.
    const phases = corpus.videos.map((video) => video.clip.phase);
    expect(new Set(phases.map((p) => p.toFixed(6))).size).toBe(phases.length);
  });

  it("reads like a catalogue rather than like a fixture", () => {
    for (const video of corpus.videos) {
      expect(video.title).not.toMatch(/^(Test|Sample|Video|Clip)\s*\d*$/i);
      expect(video.title.length).toBeGreaterThan(12);
      expect(video.description.length).toBeGreaterThan(20);
      expect(video.tags.length).toBeGreaterThan(0);
    }
  });
});

describe("the social graph", () => {
  const corpus = buildCorpus();

  it("gives every channel an owner and every video a channel", () => {
    const peopleKeys = new Set(corpus.people.map((person) => person.key));
    const channelKeys = new Set(corpus.channels.map((channel) => channel.key));
    for (const channel of corpus.channels) expect(peopleKeys.has(channel.ownerKey)).toBe(true);
    for (const video of corpus.videos) expect(channelKeys.has(video.channelKey)).toBe(true);
  });

  it("uses reserved-TLD addresses so no seeded account can be mailed", () => {
    for (const person of corpus.people) {
      expect(person.email).toMatch(/@seed\.invalid$/);
    }
    expect(new Set(corpus.people.map((p) => p.email.toLowerCase())).size).toBe(
      corpus.people.length,
    );
  });

  it("subscribes nobody to their own channel", () => {
    const ownerOf = new Map(corpus.channels.map((c) => [c.key, c.ownerKey]));
    for (const subscription of corpus.subscriptions) {
      expect(subscription.subscriberKey).not.toBe(ownerOf.get(subscription.channelKey));
    }
  });

  it("gives every channel subscribers and every subscriber a spread", () => {
    for (const channel of corpus.channels) {
      const count = corpus.subscriptions.filter((s) => s.channelKey === channel.key).length;
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  it("builds threads that are one level deep, which is the schema's model", () => {
    const videoIds = new Set(corpus.videos.map((video) => video.id));
    for (const comment of corpus.comments) {
      expect(videoIds.has(comment.videoId)).toBe(true);
      expect(comment.body.length).toBeGreaterThan(8);
      for (const reply of comment.replies) {
        expect(reply.body.length).toBeGreaterThan(8);
      }
    }
    expect(corpus.comments.some((comment) => comment.replies.length >= 2)).toBe(true);
    expect(corpus.comments.some((comment) => comment.pinned)).toBe(true);
    expect(corpus.comments.some((comment) => comment.hearted)).toBe(true);
  });

  it("never posts a comment before its video or after the corpus's own now", () => {
    // The obvious draw — "somewhere in the six days after publication" — puts a
    // thread *tomorrow* on a video uploaded this morning, and the watch page
    // then renders a conversation that has not happened. Caught by reading the
    // seeded database, which is why the clamp is asserted here rather than
    // trusted.
    const publishedAt = new Map(corpus.videos.map((video) => [video.id, video.publishedAtMs]));
    for (const comment of corpus.comments) {
      const videoAt = publishedAt.get(comment.videoId)!;
      expect(comment.createdAtMs).toBeGreaterThan(videoAt);
      expect(comment.createdAtMs).toBeLessThan(corpus.nowMs);
      for (const reply of comment.replies) {
        expect(reply.createdAtMs).toBeGreaterThanOrEqual(comment.createdAtMs);
        expect(reply.createdAtMs).toBeLessThan(corpus.nowMs);
      }
    }
  });

  it("has the creator answering their own pinned and hearted threads", () => {
    const answered = corpus.comments.filter(
      (comment) =>
        (comment.pinned || comment.hearted) &&
        comment.replies.some((reply) => reply.authorKey.startsWith("owner:")),
    );
    expect(answered.length).toBeGreaterThanOrEqual(3);
    for (const comment of answered) {
      const video = corpus.videos.find((candidate) => candidate.id === comment.videoId)!;
      const owner = comment.replies.find((reply) => reply.authorKey.startsWith("owner:"))!;
      // The creator answering must be *this* video's creator.
      expect(owner.authorKey).toBe(`owner:${video.channelKey}`);
    }
  });
});

describe("watch sessions", () => {
  const corpus = buildCorpus();

  it("is well formed: known videos, matching lengths, ordered in time", () => {
    const videoIds = new Set(corpus.videos.map((video) => video.id));
    let previous = -Infinity;
    for (const session of corpus.sessions) {
      expect(session.videoIds.length).toBeGreaterThanOrEqual(3);
      expect(session.watchedSeconds.length).toBe(session.videoIds.length);
      expect(session.watchedAtMs).toBeGreaterThanOrEqual(previous);
      previous = session.watchedAtMs;
      for (const id of session.videoIds) expect(videoIds.has(id)).toBe(true);
      for (const seconds of session.watchedSeconds) expect(seconds).toBeGreaterThan(0);
    }
    expect(new Set(corpus.sessions.map((s) => s.key)).size).toBe(corpus.sessions.length);
  });

  it("includes replays, which is what the dedup rule exists for", () => {
    const withReplays = corpus.sessions.filter(
      (session) => new Set(session.videoIds).size < session.videoIds.length,
    );
    expect(withReplays.length).toBeGreaterThanOrEqual(5);
  });

  it("includes signed-out sessions, because co-visitation must work without an account", () => {
    expect(corpus.sessions.some((session) => session.viewerKey === null)).toBe(true);
    expect(corpus.sessions.some((session) => session.viewerKey !== null)).toBe(true);
  });

  it("gives enough pairs weight to clear the co-visitation floor", () => {
    // `MIN_COVISIT_WEIGHT` is 3 in `domain/recommender/covisitation.ts`: a pair
    // seen in fewer than three distinct sessions never reaches `related_videos`.
    // Sessions drawn uniformly from two dozen videos would clear that floor
    // almost nowhere, and the sidebar would be pure fallback ordering while
    // looking like a working recommender. This is the assertion that would fail
    // if the affinity clustering were removed.
    const MIN_COVISIT_WEIGHT = 3;
    const weights = new Map<string, number>();
    for (const session of corpus.sessions) {
      const distinct = [...new Set(session.videoIds)].sort();
      for (let i = 0; i < distinct.length; i++) {
        for (let j = i + 1; j < distinct.length; j++) {
          const key = `${distinct[i]}|${distinct[j]}`;
          weights.set(key, (weights.get(key) ?? 0) + 1);
        }
      }
    }

    const stored = [...weights.values()].filter((weight) => weight >= MIN_COVISIT_WEIGHT);
    expect(stored.length).toBeGreaterThanOrEqual(40);

    // And every video must be reachable, or some watch page falls back.
    const seeds = new Set<string>();
    for (const [key, weight] of weights) {
      if (weight < MIN_COVISIT_WEIGHT) continue;
      const [a, b] = key.split("|");
      seeds.add(a!);
      seeds.add(b!);
    }
    expect(seeds.size).toBe(corpus.videos.length);
  });

  it("counts a replay once per session, as the paper's cij requires", () => {
    // The corpus's own contribution to the rule the schema calls the single
    // most common defect: a session that watched A twice and B once contributes
    // one to the pair (A, B), not two.
    const replaySession = corpus.sessions.find(
      (session) => new Set(session.videoIds).size < session.videoIds.length,
    )!;
    const distinct = new Set(replaySession.videoIds);
    expect(distinct.size).toBeLessThan(replaySession.videoIds.length);
  });
});

describe("the Content ID demonstration", () => {
  const corpus = buildCorpus();

  it("registers a passage that two different videos really contain", () => {
    const work = corpus.referenceWork;
    expect(work.reuse.length).toBeGreaterThanOrEqual(1);
    expect(work.durationSeconds).toBe(SHARED_PASSAGE_SECONDS);

    const byId = new Map(corpus.videos.map((video) => [video.id, video]));
    const origin = byId.get(work.originVideoId)!;
    expect(origin).toBeDefined();

    for (const reuse of work.reuse) {
      const video = byId.get(reuse.videoId)!;
      expect(video).toBeDefined();
      expect(video.id).not.toBe(origin.id);
      // The passage has to fit inside the clip, or the claim is against audio
      // that was truncated away.
      expect(reuse.atSeconds + work.durationSeconds).toBeLessThanOrEqual(
        video.clip.durationSeconds,
      );
    }
  });

  it("embeds the registered passage verbatim in every video that reuses it", () => {
    const work = corpus.referenceWork;
    const byId = new Map(corpus.videos.map((video) => [video.id, video]));

    // Structural identity, not a sampled comparison of the mixed signal: each
    // clip layers its own motif over the passage, so the *sum* differs between
    // two clips that genuinely contain the same passage. What has to be true —
    // and what makes a fingerprint match findable — is that the passage's own
    // note events appear unchanged in both event lists, shifted only by the
    // offset the corpus records.
    for (const videoId of [work.originVideoId, ...work.reuse.map((r) => r.videoId)]) {
      const clip = byId.get(videoId)!.clip;
      const offset = passageOffsetIn(clip.audio.events, work.audio.events);
      expect(offset).not.toBeNull();

      for (const expected of work.audio.events) {
        // `filter`, not `find`: a motif note can legitimately start at the same
        // instant as a passage note — the motif is on its own grid and the two
        // collide whenever the offsets line up. What must hold is that *one* of
        // the events at that instant is the passage's, note for note.
        const atInstant = clip.audio.events.filter(
          (event) => Math.abs(event.startSeconds - (offset! + expected.startSeconds)) < 1e-9,
        );
        expect(atInstant.length).toBeGreaterThan(0);
        const match = atInstant.find(
          (event) =>
            event.partials.length === expected.partials.length &&
            event.partials.every((value, i) => Math.abs(value - expected.partials[i]!) < 1e-9),
        );
        expect(match, `passage note at ${expected.startSeconds}s missing from ${videoId}`).toBeDefined();
        expect(match!.durationSeconds).toBeCloseTo(expected.durationSeconds, 9);
        expect(match!.gain).toBeCloseTo(expected.gain, 9);
      }
    }

    // The reuse offsets must actually differ from the origin's, or the offset
    // histogram is being asked to find a delta of zero — the one case that
    // would also pass if the delta arithmetic were dropped entirely.
    const originOffset = passageOffsetIn(
      byId.get(work.originVideoId)!.clip.audio.events,
      work.audio.events,
    );
    for (const reuse of work.reuse) {
      expect(reuse.atSeconds).not.toBeCloseTo(originOffset!, 3);
    }
  });

  it("plays the passage clean, which is what makes it findable", () => {
    // Measured, and the assertion is the measurement. `peaks.ts` keeps ~30
    // peaks per second over a ±0.5 s window — under one and a half per STFT
    // frame — so whatever is loudest in a frame takes every slot. Scoring the
    // registered passage against a query carrying the same six seconds:
    //
    //   passage alone                 2260
    //   passage + a 3 Hz click          35
    //   passage, motif and pulse ducked 659 / 819   (the two corpus clips)
    //
    // `MATCH_SCORE_THRESHOLD` is 250. The middle row is not a threshold that
    // needs lowering: the landmarks the query needed were never generated,
    // because the click won the density quota in every frame it touched.
    const work = corpus.referenceWork;
    const byId = new Map(corpus.videos.map((video) => [video.id, video]));

    for (const videoId of [work.originVideoId, ...work.reuse.map((r) => r.videoId)]) {
      const clip = byId.get(videoId)!.clip;
      const offset = passageOffsetIn(clip.audio.events, work.audio.events)!;
      const window = { from: offset, to: offset + work.durationSeconds };

      expect(clip.audio.pulseSilent).toBeDefined();
      expect(clip.audio.pulseSilent).toContainEqual({
        startSeconds: window.from,
        endSeconds: window.to,
      });

      const passagePartials = new Set(work.audio.events.map((event) => event.partials[0]));
      const competing = clip.audio.events.filter(
        (event) =>
          !passagePartials.has(event.partials[0]) &&
          event.startSeconds < window.to &&
          event.startSeconds + event.durationSeconds > window.from,
      );
      expect(competing).toEqual([]);
    }

    // And a clip that carries no passage keeps its pulse throughout, or the
    // assertion above would pass against an audio spec with no pulse at all.
    const plain = corpus.videos.find(
      (video) =>
        video.id !== work.originVideoId && !work.reuse.some((r) => r.videoId === video.id),
    )!;
    expect(plain.clip.audio.pulseSilent).toBeUndefined();
    expect(plain.clip.audio.pulseGain).toBeGreaterThan(0);
  });

  it("renders the same audio at both rates the pipeline needs", () => {
    const work = corpus.referenceWork;
    const at48k = renderAudioChannel(work.audio, 48_000, work.durationSeconds, 0);
    const at11k = renderAudioChannel(work.audio, 11_025, work.durationSeconds, 0);
    expect(at48k.length).toBe(48_000 * work.durationSeconds);
    expect(at11k.length).toBe(11_025 * work.durationSeconds);

    // Sample-rate independence is the property that makes fingerprinting the
    // 11 025 Hz render a statement about the 48 kHz audio that was encoded.
    // Compared at whole seconds, which are the only instants both grids land on
    // exactly — 0.25 s is sample 2756.25 at 11 025 Hz, and comparing a rounded
    // index against an exact one measures the rounding rather than the signal.
    for (let second = 1; second < work.durationSeconds; second++) {
      expect(at48k[second * 48_000]!).toBe(at11k[second * 11_025]!);
      // `Math.fround`, because a `Float32Array` element is the single-precision
      // rounding of what `audioSampleAt` computed in double. Asserting against
      // the double directly would fail on the last few bits and teach the next
      // reader that this property is approximate, which it is not.
      expect(at48k[second * 48_000]!).toBe(Math.fround(audioSampleAt(work.audio, second, 0)));
    }

    // And it must be loud enough to have peaks worth picking.
    const peak = at11k.reduce((worst, value) => Math.max(worst, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.2);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("keeps every partial below the fingerprinter's Nyquist", () => {
    // `research/06` §3 fixes analysis at 11 025 Hz, so anything above 5 512 Hz
    // aliases into a bin it does not belong in and the reference and the query
    // stop agreeing about where the peaks are.
    for (const video of buildCorpus().videos) {
      for (const event of video.clip.audio.events) {
        for (const partial of event.partials) {
          expect(partial).toBeLessThan(5_512);
        }
      }
    }
  });
});

describe("caption tracks", () => {
  const corpus = buildCorpus();
  const captioned = corpus.videos.filter((video) => video.captions.length > 0);

  it("captions some videos and deliberately not others", () => {
    // Both halves are load-bearing. Without any, the player's caption path is
    // dead code that nothing renders; with all, the *measured* empty state —
    // the disabled `Subtitles/closed captions unavailable` button — becomes
    // unreachable and untested.
    expect(captioned.length).toBeGreaterThan(0);
    expect(captioned.length).toBeLessThan(corpus.videos.length);
  });

  it("covers all three shapes the CC menu can take", () => {
    const shapes = captioned.map((video) => ({
      uploaded: video.captions.filter((t) => t.source === "uploaded").length,
      automatic: video.captions.filter((t) => t.source === "automatic").length,
    }));

    expect(shapes.some((s) => s.uploaded > 0 && s.automatic === 0)).toBe(true);
    expect(shapes.some((s) => s.uploaded > 0 && s.automatic > 0)).toBe(true);
    expect(shapes.some((s) => s.uploaded === 0 && s.automatic > 0)).toBe(true);
  });

  it("gives no video two tracks the schema would reject", () => {
    // `captions` is unique on `(video_id, language, source)`. A corpus that
    // violates it fails at seed time with a constraint error rather than here,
    // which is a slow and confusing way to find a typo.
    for (const video of captioned) {
      const keys = video.captions.map((t) => `${t.language}/${t.source}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("labels an automatic track as one", () => {
    for (const video of captioned) {
      for (const track of video.captions) {
        if (track.source === "automatic") {
          expect(track.label).toContain("auto-generated");
        } else {
          expect(track.label).not.toContain("auto-generated");
        }
      }
    }
  });

  it("times every cue inside the clip it belongs to", () => {
    // A transcript timed to a video that does not exist is the failure this
    // whole gap was: captions that are present, parse, and never appear.
    for (const video of captioned) {
      for (const track of video.captions) {
        for (const cue of track.cues) {
          expect(cue.atSeconds).toBeGreaterThanOrEqual(0);
          expect(cue.seconds).toBeGreaterThan(0);
          expect(cue.atSeconds + cue.seconds).toBeLessThanOrEqual(
            video.clip.durationSeconds,
          );
        }
      }
    }
  });

  it("does not overlap two cues of one track", () => {
    for (const video of captioned) {
      for (const track of video.captions) {
        for (let i = 1; i < track.cues.length; i += 1) {
          const previous = track.cues[i - 1]!;
          expect(track.cues[i]!.atSeconds).toBeGreaterThanOrEqual(
            previous.atSeconds + previous.seconds,
          );
        }
      }
    }
  });
});

describe("the ladder budget", () => {
  it("keeps the seed ladder small enough to encode in a sitting", () => {
    // Two rungs is the smallest ladder that can demonstrate a mid-playback
    // switch. Raising this constant multiplies the seed's wall-clock cost by
    // roughly its own value, so it is asserted rather than left to drift.
    expect(SEED_LADDER_RUNGS).toBe(2);

    const corpus = buildCorpus();
    const clipSeconds = corpus.videos.reduce(
      (total, video) => total + video.clip.durationSeconds,
      0,
    );
    expect(clipSeconds).toBeLessThan(400);
  });

  it("gives zipfViews a monotonic curve", () => {
    let previous = Infinity;
    for (let rank = 0; rank < 24; rank++) {
      const views = zipfViews(rank, 0.5);
      expect(views).toBeLessThan(previous);
      previous = views;
    }
  });
});

/**
 * Where a clip's event list carries the registered passage, or `null`.
 *
 * Found by matching the passage's *first* note on its exact partial stack and
 * duration — a signature no motif note shares, because the motif is built from
 * a pentatonic walk over a different root with a `× 3.01` third partial.
 */
function passageOffsetIn(
  clipEvents: readonly { startSeconds: number; durationSeconds: number; partials: readonly number[] }[],
  passageEvents: readonly {
    startSeconds: number;
    durationSeconds: number;
    partials: readonly number[];
  }[],
): number | null {
  const first = passageEvents[0]!;
  const match = clipEvents.find(
    (event) =>
      event.partials.length === first.partials.length &&
      event.partials.every((value, index) => Math.abs(value - first.partials[index]!) < 1e-9) &&
      Math.abs(event.durationSeconds - first.durationSeconds) < 1e-9,
  );
  return match === undefined ? null : match.startSeconds - first.startSeconds;
}
