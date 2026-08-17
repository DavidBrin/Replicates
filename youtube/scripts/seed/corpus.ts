/**
 * What exists, stated once, as data.
 *
 * This module is the whole determinism argument. Everything downstream of it —
 * the ids in the URLs, the bytes in `.data/blobs`, the co-visitation weights the
 * recommender ranks on — is a pure function of the value `buildCorpus` returns,
 * so pinning that value pins the corpus. There is no `Math.random()` here and
 * no `Date.now()`; a run in six months produces the same database as a run
 * today, which is what lets an e2e test assert an exact feed order instead of a
 * shape.
 *
 * Three rules hold that up, and each is easy to break by accident:
 *
 *  - **One PRNG, drawn in one order.** {@link mulberry32} is seeded once and
 *    consumed strictly top to bottom. Reordering two `rng()` calls changes every
 *    number after them, so the draws are grouped per entity and never
 *    interleaved with a loop whose length could change.
 *  - **Time is a parameter.** `nowMs` defaults to {@link CORPUS_EPOCH_MS} — a
 *    fixed instant — rather than to the clock. The cost is that a corpus seeded
 *    today and read next year says "1 year ago" everywhere; the benefit is that
 *    two runs agree, which the brief makes non-negotiable. `--now` on the seed
 *    script overrides it for a screenshot run.
 *  - **No imports.** Not stylistic: this file is loaded by Node *and* served to
 *    headless Chromium (`scripts/seed/page/`), so anything it imported would
 *    have to resolve in both. Keeping it dependency-free keeps that seam free.
 *
 * The clip specs live here too, beside the titles, because a clip's palette and
 * its title are the same decision — "the modular-synth channel's videos look
 * magenta and sound like an arpeggio" is one identity, not two. `synthesise.ts`
 * renders these specs; it does not invent them.
 */

/* ============================================================ the PRNG == */

/**
 * mulberry32 — 32 bits of state, one multiply-xorshift round per draw.
 *
 * Written out rather than imported for the reason the muxer is written out: the
 * interesting property (that two runs agree) should not be a dependency. It is
 * also the only PRNG shape that is *portable by construction* — every operation
 * below is `Math.imul`, `>>>` or `^`, all of which are exactly specified on
 * uint32 values, so V8 in Node and V8 in Chromium produce identical sequences.
 * A generator built on floating-point accumulation would not have that
 * guarantee, and the failure would be a corpus that differs between the half
 * generated in the page and the half generated on the server.
 *
 * Statistical quality is beside the point here — nothing is being simulated,
 * only spread — but mulberry32 passes gjrand's full suite, which is more than
 * the `sin(seed)` trick usually reached for.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random-access helper set, so no call site rolls its own rounding. */
interface Draw {
  /** A float in [min, max). */
  between(min: number, max: number): number;
  /** An integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number;
  /** One element. Throws on an empty list rather than returning `undefined`. */
  pick<T>(items: readonly T[]): T;
  /** A stable shuffle of a copy. Fisher-Yates, drawn back to front. */
  shuffle<T>(items: readonly T[]): T[];
}

function draws(rng: () => number): Draw {
  const between = (min: number, max: number): number => min + rng() * (max - min);
  return {
    between,
    int: (min, max) => Math.floor(between(min, max + 1)),
    pick<T>(items: readonly T[]): T {
      const chosen = items[Math.floor(rng() * items.length)];
      if (chosen === undefined) {
        throw new Error("Cannot pick from an empty list; the corpus is malformed.");
      }
      return chosen;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const a = copy[i]!;
        const b = copy[j]!;
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
  };
}

/* ========================================================== constants == */

/** The seed. Changing it changes every id in the corpus. */
export const CORPUS_SEED = 20260816;

/**
 * The corpus's "now". Fixed, so `published_at` is reproducible.
 *
 * 2026-08-16T12:00:00Z is the day this slice was built, which makes the newest
 * video "3 hours ago" on the day of writing and progressively older afterwards.
 * That ageing is the accepted cost of determinism — see the module header.
 */
export const CORPUS_EPOCH_MS = Date.UTC(2026, 7, 16, 12, 0, 0);

/**
 * How many ladder rungs a seed clip gets.
 *
 * Two, not six. `selectLadder` would hand a 640×360 source three rungs and a
 * 1080p source six, and every extra rung is another full encode of every frame.
 * Two adjacent rungs is the smallest ladder that can demonstrate the thing a
 * ladder is *for* — a mid-playback switch — so it is what the corpus pays for.
 * A real upload still gets the full ladder; nothing in `src/media/encode`
 * knows this constant exists.
 */
export const SEED_LADDER_RUNGS = 2;

/** Frame rate for every synthetic clip. */
export const CLIP_FRAME_RATE = 30;

/** Landscape source size. 640×360 tops out the ladder at the 360p rung. */
export const LANDSCAPE = { width: 640, height: 360 } as const;

/** Vertical source size, for the Shorts shelf. Same short side, rotated. */
export const VERTICAL = { width: 360, height: 640 } as const;

/**
 * The alphabet a video id is drawn from.
 *
 * `nanoid`'s default, which `videos.ts` picks deliberately so that generated
 * ids are indistinguishable in shape from the ones in a real `/watch?v=` URL.
 * Reproduced rather than imported because this module has no imports, and
 * asserted against `newVideoId()`'s length in the repository's own suite.
 */
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const VIDEO_ID_LENGTH = 11;

/* ============================================================== clips == */

/** How a clip is painted. Each renders to a visibly different frame. */
export type VisualKind =
  | "gradient"
  | "waveform"
  | "drift"
  | "counter"
  | "bars"
  | "orbit";

/** Three hex colours: background, primary ink, accent. */
export type Palette = readonly [string, string, string];

/**
 * One tone event: a stack of partials over a window of the clip's timeline.
 *
 * Rendered as a pure function of *time*, never of sample index — the page
 * renders this at 48 kHz stereo for the AAC encoder and Node renders the same
 * spec at 11 025 Hz mono for the fingerprinter (`research/06` §3 fixes that
 * rate), and a sample-indexed generator would produce two different signals
 * from one spec. Every partial stays under 4 kHz so that both rates carry it
 * without aliasing: 11 025 Hz Nyquist is 5 512 Hz.
 */
export interface ToneEvent {
  readonly startSeconds: number;
  readonly durationSeconds: number;
  /** Fundamental plus harmonics, in Hz. */
  readonly partials: readonly number[];
  readonly gain: number;
}

export interface AudioSpec {
  /** A steady pulse under the tones, so the constellation has onsets. */
  readonly pulseHz: number;
  readonly pulseGain: number;
  /**
   * Windows where the pulse ducks out.
   *
   * **Measured, and the reason the Content ID demonstration works at all.**
   * `peaks.ts` keeps 30 peaks per second over a ±0.5 s window, which at this
   * hop is fewer than one and a half peaks per STFT frame — so the loudest
   * thing in a frame takes essentially every slot. Fingerprinting the same
   * six-second passage against its own registration scored **2260** clean and
   * **35** with a 3 Hz click layered over it: the click is a transient, it wins
   * the quota in every frame it lands in, and the passage's own peaks never
   * enter the constellation. Not a threshold problem — the landmarks the query
   * needed were never generated.
   *
   * So a video that plays a licensed passage plays it, rather than playing it
   * underneath a competing rhythm. Which is also what a real video does.
   */
  readonly pulseSilent?: readonly { readonly startSeconds: number; readonly endSeconds: number }[];
  readonly events: readonly ToneEvent[];
}

export interface ClipSpec {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly frameRate: number;
  readonly visual: VisualKind;
  readonly palette: Palette;
  /** Drawn into the frame, so a still tells you which clip you are looking at. */
  readonly caption: string;
  /** Per-clip motion phase, so two clips of one kind do not move in lockstep. */
  readonly phase: number;
  readonly audio: AudioSpec;
}

/* ============================================ the shared musical passage == */

/**
 * The passage two videos have in common, and the thing Content ID exists to
 * find.
 *
 * A rights-holder registers this as a `reference_works` row and fingerprints
 * it; a second video contains the same six seconds at a different offset, and
 * the offset histogram in `adapters/repositories/content-id.ts` has to spike.
 * That is only a demonstration if the audio really is the same audio, so both
 * videos embed *this array*, transposed by nothing, at offsets the corpus
 * records — no re-recording, no "similar" melody.
 *
 * Ten notes over six seconds with three partials each. The note changes are
 * what the fingerprinter actually keys on: `research/06` §1.2 picks spectral
 * peaks, and a sustained drone gives a constellation with no time structure,
 * which hashes but does not localise. A melody gives Δt variety inside the
 * target zone, which is what `hash.ts` packs.
 */
const PASSAGE_NOTES: readonly number[] = [
  293.66, 440.0, 587.33, 493.88, 392.0, 587.33, 440.0, 349.23, 293.66, 440.0,
];

export const SHARED_PASSAGE_SECONDS = 6;

function sharedPassageEvents(offsetSeconds: number): ToneEvent[] {
  const noteSeconds = SHARED_PASSAGE_SECONDS / PASSAGE_NOTES.length;
  return PASSAGE_NOTES.map((fundamental, index) => ({
    startSeconds: offsetSeconds + index * noteSeconds,
    // Slightly longer than the slot, so notes overlap and the spectrogram has
    // transitions rather than silence between every pair of peaks.
    durationSeconds: noteSeconds * 1.35,
    partials: [fundamental, fundamental * 2, fundamental * 3],
    gain: 0.28,
  }));
}

/** The passage alone, as its own clip-length spec — what gets registered. */
export function sharedPassageSpec(): AudioSpec {
  return { pulseHz: 0, pulseGain: 0, events: sharedPassageEvents(0) };
}

/* ============================================================ entities == */

export interface CorpusPerson {
  /** Stable key used to wire relationships together before ids exist. */
  readonly key: string;
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
  /** Set for the six channel owners; absent for plain viewers. */
  readonly handle?: string;
}

export interface CorpusChannel {
  readonly key: string;
  readonly ownerKey: string;
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly palette: Palette;
  /** One or two characters drawn into the generated avatar. */
  readonly monogram: string;
}

export interface CorpusVideo {
  readonly id: string;
  readonly channelKey: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly pipeline: "laddered" | "progressive";
  readonly isVertical: boolean;
  /** Milliseconds since the epoch. Written into `videos.published_at`. */
  readonly publishedAtMs: number;
  readonly viewCount: number;
  readonly likeCount: number;
  readonly dislikeCount: number;
  readonly clip: ClipSpec;
  /** Where the poster frame is taken from, in clip seconds. */
  readonly thumbnailAtSeconds: number;
  /** The hover preview's window, in clip seconds. */
  readonly previewStartSeconds: number;
  readonly previewSeconds: number;
}

export interface CorpusReply {
  readonly authorKey: string;
  readonly body: string;
  readonly likeCount: number;
  readonly createdAtMs: number;
}

export interface CorpusComment {
  readonly videoId: string;
  readonly authorKey: string;
  readonly body: string;
  readonly likeCount: number;
  readonly pinned: boolean;
  readonly hearted: boolean;
  /**
   * Absolute, and clamped into `(publishedAt, nowMs)`.
   *
   * Stated as an instant rather than as an offset because the clamp is the
   * point: a comment drawn as "up to six days after publication" lands *after
   * the corpus's own now* on a video published this morning, and the watch page
   * then renders a thread posted tomorrow. Doing the arithmetic here keeps it
   * where the tests can see it.
   */
  readonly createdAtMs: number;
  readonly replies: readonly CorpusReply[];
}

export interface CorpusSession {
  /** The cookie value `watch_events.session_key` stores. */
  readonly key: string;
  readonly viewerKey: string | null;
  readonly watchedAtMs: number;
  /** In watch order. A repeat is a genuine replay and must not double-count. */
  readonly videoIds: readonly string[];
  readonly watchedSeconds: readonly number[];
}

export interface CorpusSubscription {
  readonly subscriberKey: string;
  readonly channelKey: string;
  readonly notifications: "all" | "personalised" | "none";
}

export interface CorpusReaction {
  readonly viewerKey: string;
  readonly videoId: string;
  readonly value: 1 | -1;
}

export interface CorpusPlaylist {
  readonly ownerKey: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: "public" | "unlisted" | "private";
  readonly videoIds: readonly string[];
}

export interface CorpusProgress {
  readonly viewerKey: string;
  readonly videoId: string;
  readonly positionSeconds: number;
  readonly completed: boolean;
  readonly updatedAtMs: number;
}

export interface CorpusReferenceWork {
  readonly title: string;
  readonly rightsHolder: string;
  readonly policy: "block" | "monetise" | "track";
  /** The video the passage originally came from. */
  readonly originVideoId: string;
  /** The videos that reuse it, and where the passage starts in each. */
  readonly reuse: readonly { readonly videoId: string; readonly atSeconds: number }[];
  readonly audio: AudioSpec;
  readonly durationSeconds: number;
}

export interface Corpus {
  readonly seed: number;
  readonly nowMs: number;
  readonly people: readonly CorpusPerson[];
  readonly channels: readonly CorpusChannel[];
  readonly videos: readonly CorpusVideo[];
  readonly comments: readonly CorpusComment[];
  readonly subscriptions: readonly CorpusSubscription[];
  readonly reactions: readonly CorpusReaction[];
  readonly sessions: readonly CorpusSession[];
  readonly playlists: readonly CorpusPlaylist[];
  readonly progress: readonly CorpusProgress[];
  readonly referenceWork: CorpusReferenceWork;
}

/* ======================================================== the material == */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Six channels, each with an identity a screenshot can tell apart.
 *
 * The palettes are not decoration — they are what every clip on that channel is
 * painted from, so the home grid reads as six creators rather than as one
 * generator with a hue parameter. A `Test Video 3` corpus and a
 * one-palette corpus fail in the same way: they look like fixtures.
 */
const CHANNEL_SOURCE: readonly {
  key: string;
  handle: string;
  name: string;
  monogram: string;
  owner: string;
  description: string;
  palette: Palette;
}[] = [
  {
    key: "lumen",
    handle: "lumendesk",
    name: "Lumen Desk",
    monogram: "LD",
    owner: "Priya Raman",
    description:
      "Desk builds, cable management and the lighting nobody notices until it is wrong. New build every other Tuesday.",
    palette: ["#171207", "#ffd483", "#ff8a3d"],
  },
  {
    key: "field",
    handle: "fieldnotes",
    name: "Field Notes",
    monogram: "FN",
    owner: "Tomas Eklund",
    description:
      "Two-day walks, one camera, no drone. Route notes and gear weights in every description.",
    palette: ["#08150f", "#9ff0c4", "#2fbf71"],
  },
  {
    key: "patchbay",
    handle: "thepatchbay",
    name: "The Patch Bay",
    monogram: "PB",
    owner: "Ines Costa",
    description:
      "Modular synthesis without the mystique. Patch-along videos, and every patch sheet is free.",
    palette: ["#150818", "#f5a3ff", "#c026d3"],
  },
  {
    key: "stackframe",
    handle: "stackframe",
    name: "Stackframe",
    monogram: "SF",
    owner: "Dan Okoye",
    description:
      "Reading real codebases out loud. Debuggers, profilers, and the parts of the manual nobody reaches.",
    palette: ["#070f1d", "#9ec5ff", "#3b82f6"],
  },
  {
    key: "kitchen",
    handle: "slowkitchen",
    name: "Slow Kitchen",
    monogram: "SK",
    owner: "Marta Vidal",
    description:
      "Long cooks, short ingredient lists. Weights in grams because cups are a lie.",
    palette: ["#1a0a07", "#ffc0a8", "#ef5b3c"],
  },
  {
    key: "orbital",
    handle: "orbitallab",
    name: "Orbital Lab",
    monogram: "OL",
    owner: "Hana Ito",
    description:
      "Orbital mechanics explained with things you can hold. Sources linked, arithmetic shown.",
    palette: ["#0a0a1c", "#c3c8ff", "#6366f1"],
  },
];

/** Viewers who are not creators: the people who comment, like and subscribe. */
const VIEWER_NAMES: readonly string[] = [
  "Alex Whitfield",
  "Bea Nakamura",
  "Caleb Ortiz",
  "Dora Lindqvist",
  "Emeka Balogun",
  "Fiona Doyle",
  "Grigor Petrov",
  "Hallie Mbeki",
  "Ivan Delgado",
  "Jules Fontaine",
  "Kiran Shah",
  "Lena Brandt",
  "Mo Haddad",
  "Nell Ferreira",
  "Otto Jansen",
  "Pia Kowalski",
  "Quentin Roy",
  "Rita Sandoval",
];

interface VideoSource {
  readonly channelKey: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly visual: VisualKind;
  readonly seconds: number;
  readonly vertical?: true;
  readonly progressive?: true;
  /** Set on the two videos that carry the Content ID passage. */
  readonly passageAtSeconds?: number;
}

/**
 * The catalogue, in publication order (newest first).
 *
 * Ordered rather than shuffled because the publication dates below are assigned
 * by index, and a reader comparing this list against the home grid should be
 * able to follow it top to bottom. The durations are the *real* lengths of the
 * clips that get encoded — a row claiming 8:32 above six seconds of media is a
 * player bug wearing a plausible number, so the corpus tells the truth and
 * accepts that its videos are short.
 */
const VIDEO_SOURCE: readonly VideoSource[] = [
  {
    channelKey: "lumen",
    title: "The £40 lamp that fixed my whole desk",
    description:
      "Bias lighting, colour temperature and why the ceiling light is the enemy. Measurements at 1:40, the build at 4:05.\n\nEverything on the desk is listed below with what it actually cost, not what it costs on a good day.",
    category: "Science & Technology",
    tags: ["desk setup", "lighting", "workspace"],
    visual: "gradient",
    seconds: 18,
  },
  {
    channelKey: "patchbay",
    title: "One oscillator, six patches",
    description:
      "How far a single VCO goes before you need a second one. Patch sheets in the description as always.\n\nThe ostinato in this one is from the Patch Bay Sessions library — reuse it, just credit it.",
    category: "Music",
    tags: ["modular", "synthesis", "eurorack"],
    visual: "waveform",
    seconds: 20,
    passageAtSeconds: 5,
  },
  {
    channelKey: "stackframe",
    title: "Reading SQLite's B-tree code, part 1",
    description:
      "Starting at btree.c and following a single INSERT all the way to the page cache. No slides.\n\nPart 2 covers overflow pages and the freelist.",
    category: "Science & Technology",
    tags: ["sqlite", "databases", "c"],
    visual: "counter",
    seconds: 22,
  },
  {
    channelKey: "field",
    title: "Two days on the Cape Wrath trail with 6kg",
    description:
      "The full pack list weighed item by item, and the three things I would leave behind next time.\n\nRoute GPX linked. Water was the whole problem.",
    category: "Travel & Events",
    tags: ["hiking", "ultralight", "scotland"],
    visual: "drift",
    seconds: 19,
  },
  {
    channelKey: "kitchen",
    title: "Bread with four ingredients and no machine",
    description:
      "500g flour, 350g water, 10g salt, 2g yeast. Eighteen hours, most of it doing nothing.\n\nThe fold at 3:10 is the only part that matters.",
    category: "Howto & Style",
    tags: ["bread", "baking", "no knead"],
    visual: "orbit",
    seconds: 16,
  },
  {
    channelKey: "orbital",
    title: "Why geostationary orbit is exactly 35,786 km",
    description:
      "Derived from first principles with a calculator on screen. If you can multiply you can follow this.\n\nSources in the description; the sidereal day is the part everyone gets wrong.",
    category: "Education",
    tags: ["orbital mechanics", "physics", "space"],
    visual: "bars",
    seconds: 21,
  },
  {
    channelKey: "lumen",
    title: "Cable management that survives a monitor swap",
    description:
      "Velcro over zip ties, service loops, and where to put the brick. Twenty minutes now, an hour saved later.",
    category: "Science & Technology",
    tags: ["cable management", "desk setup"],
    visual: "drift",
    seconds: 14,
  },
  {
    channelKey: "stackframe",
    title: "perf top, explained line by line",
    description:
      "What the columns mean, what a symbol with no name is telling you, and when the numbers are lying.",
    category: "Science & Technology",
    tags: ["performance", "linux", "profiling"],
    visual: "bars",
    seconds: 17,
  },
  {
    channelKey: "patchbay",
    title: "Sequencing without a sequencer",
    description:
      "Clock division, sample and hold, and a shift register. The same ostinato as the oscillator video, on purpose.",
    category: "Music",
    tags: ["modular", "sequencing", "eurorack"],
    visual: "orbit",
    seconds: 18,
    passageAtSeconds: 8,
  },
  {
    channelKey: "field",
    title: "Reading a map when the phone is dead",
    description:
      "Bearings, pacing and handrails. Everything here works in the rain, which is the whole point.",
    category: "Travel & Events",
    tags: ["navigation", "hiking", "map reading"],
    visual: "gradient",
    seconds: 15,
  },
  {
    channelKey: "orbital",
    title: "The Oberth effect with a bicycle wheel",
    description:
      "Why a burn deep in a gravity well buys more than the same burn higher up. Demonstrated, then derived.",
    category: "Education",
    tags: ["orbital mechanics", "physics"],
    visual: "counter",
    seconds: 20,
  },
  {
    channelKey: "kitchen",
    title: "Stock from bones you already threw away",
    description:
      "Six hours, one pot, no stock cubes. Skim once at the start and then leave it alone.",
    category: "Howto & Style",
    tags: ["stock", "slow cooking", "basics"],
    visual: "waveform",
    seconds: 13,
  },
  {
    channelKey: "stackframe",
    title: "A crash course in reading core dumps",
    description:
      "From a bare SIGSEGV to a named frame, with nothing but gdb and the binary you already shipped.",
    category: "Science & Technology",
    tags: ["debugging", "gdb", "c"],
    visual: "drift",
    seconds: 16,
  },
  {
    channelKey: "lumen",
    title: "Standing desk, sitting brain",
    description:
      "Three months of alternating and what actually changed. Uploaded straight from the phone, no ladder.",
    category: "People & Blogs",
    tags: ["desk setup", "health"],
    visual: "gradient",
    seconds: 12,
    progressive: true,
  },
  {
    channelKey: "field",
    title: "Wild camping without leaving a mark",
    description:
      "Site selection, the six-inch rule, and packing out what you would rather not.",
    category: "Travel & Events",
    tags: ["camping", "leave no trace"],
    visual: "bars",
    seconds: 14,
  },
  {
    channelKey: "orbital",
    title: "How a solar sail turns light into speed",
    description:
      "Photon momentum, worked out slowly. The numbers are tiny and they still get you to Mercury.",
    category: "Education",
    tags: ["solar sail", "physics", "space"],
    visual: "orbit",
    seconds: 18,
  },
  {
    channelKey: "patchbay",
    title: "Filter self-oscillation is a free sine",
    description:
      "Turn the resonance up until the filter sings, then use it as an oscillator. Tuning it is the hard part.",
    category: "Music",
    tags: ["modular", "filters", "eurorack"],
    visual: "waveform",
    seconds: 15,
  },
  {
    channelKey: "kitchen",
    title: "Knife sharpening on a £12 stone",
    description:
      "Angle, pressure, burr. Ten minutes a month and you never buy a knife again.",
    category: "Howto & Style",
    tags: ["knives", "sharpening", "kitchen basics"],
    visual: "counter",
    seconds: 17,
  },

  /* --------------------------------------------------------- vertical -- */

  {
    channelKey: "lumen",
    title: "Hide the power brick in 20 seconds",
    description: "One velcro strap, one hook. That is the whole video.",
    category: "Science & Technology",
    tags: ["desk setup", "shorts"],
    visual: "drift",
    seconds: 8,
    vertical: true,
  },
  {
    channelKey: "kitchen",
    title: "Salt your pasta water like this",
    description: "It should taste like the sea. That is not a figure of speech.",
    category: "Howto & Style",
    tags: ["pasta", "shorts"],
    visual: "orbit",
    seconds: 6,
    vertical: true,
  },
  {
    channelKey: "patchbay",
    title: "A whole track from one cable",
    description: "Self-patching, in under ten seconds.",
    category: "Music",
    tags: ["modular", "shorts"],
    visual: "waveform",
    seconds: 9,
    vertical: true,
  },
  {
    channelKey: "field",
    title: "Pitch a tarp in high wind",
    description: "Low end into the wind, always. Learned the hard way.",
    category: "Travel & Events",
    tags: ["camping", "shorts"],
    visual: "gradient",
    seconds: 7,
    vertical: true,
  },
  {
    channelKey: "stackframe",
    title: "git bisect run, in one line",
    description: "Stop bisecting by hand. Give it a script and go and get coffee.",
    category: "Science & Technology",
    tags: ["git", "shorts"],
    visual: "counter",
    seconds: 6,
    vertical: true,
  },
  {
    channelKey: "orbital",
    title: "Why the ISS looks like it is falling",
    description: "Because it is. It just keeps missing.",
    category: "Education",
    tags: ["space", "shorts"],
    visual: "bars",
    seconds: 8,
    vertical: true,
  },
];

/* ============================================================ comments == */

interface CommentSource {
  readonly videoIndex: number;
  readonly body: string;
  readonly pinned?: true;
  readonly hearted?: true;
  readonly replies?: readonly string[];
}

/**
 * Threads that read like conversations rather than like filler.
 *
 * One level deep, because that is the model `comments.ts` enforces — a reply to
 * a reply is re-parented onto the top-level comment and the addressee is
 * mentioned in the body. The third entry in a `replies` array therefore lands
 * beside the second rather than under it, and the repository writes the `@…`
 * prefix itself; nothing here has to spell it.
 */
const COMMENT_SOURCE: readonly CommentSource[] = [
  {
    videoIndex: 0,
    body: "The bit at 1:40 about measuring at the desk surface rather than at the lamp is the thing nobody says. Completely changed my setup.",
    pinned: true,
    hearted: true,
    replies: [
      "Same. I had been pointing a lux meter at the bulb like an idiot for a year.",
      "Which meter are you both using? The phone apps disagree with each other by about 30%.",
    ],
  },
  {
    videoIndex: 0,
    body: "£40 is doing some heavy lifting there, that lamp is £58 now",
    replies: ["Prices in the description are what I paid, they move constantly. Sorry."],
  },
  {
    videoIndex: 0,
    body: "Finally a desk video that is not just a list of things to buy.",
  },
  {
    videoIndex: 1,
    body: "That ostinato is going straight into a track. Thank you for making the library free.",
    hearted: true,
    replies: [
      "Credit it and it is yours. That is the only condition.",
      "Already used it, already credited. It is in the second half of the video I posted today.",
    ],
  },
  {
    videoIndex: 1,
    body: "Patch three is essentially a Rungler and I did not see it until the third watch",
  },
  {
    videoIndex: 2,
    body: "Please do the freelist. Everyone stops before the freelist.",
    replies: ["Part 2. It is recorded, I am just cutting it down from ninety minutes."],
  },
  {
    videoIndex: 2,
    body: "The moment you opened the hex dump next to the struct definition it all clicked. More of that.",
    pinned: true,
  },
  {
    videoIndex: 3,
    body: "6kg including water? That cannot include water.",
    replies: [
      "Base weight, so no water and no food. Should have said so on screen.",
      "Base weight is the standard, it is fine. 6kg base is still very good.",
    ],
  },
  {
    videoIndex: 3,
    body: "Did Cape Wrath in June and the ferry situation alone is worth a video",
  },
  {
    videoIndex: 4,
    body: "Made this twice. The second one was better because I stopped touching it.",
    hearted: true,
  },
  {
    videoIndex: 4,
    body: "2g of yeast feels like nothing and then you wait eighteen hours and it is enormous",
    replies: ["That is the whole trick. Time instead of yeast."],
  },
  {
    videoIndex: 5,
    body: "The sidereal day thing gets me every time. 23h56m is such a small difference and it is completely load-bearing.",
    pinned: true,
    replies: [
      "It is about four minutes a day, which is a whole extra rotation over a year. That framing helped me.",
      "That is a genuinely lovely way to put it, I am stealing that for a class.",
    ],
  },
  {
    videoIndex: 5,
    body: "Calculator on screen is such a good decision. I could follow every step.",
  },
  {
    videoIndex: 6,
    body: "Service loops. I have been fighting my desk for two years and it was service loops.",
  },
  {
    videoIndex: 7,
    body: "The bit about symbols with no name being a stripped binary rather than a bug saved me an afternoon",
    hearted: true,
  },
  {
    videoIndex: 8,
    body: "Shift register as a sequencer is such a good idea and I have never seen anyone explain the clock division clearly before",
    replies: ["The patch sheet has the division table on the back page."],
  },
  {
    videoIndex: 9,
    body: "Handrails. Nobody teaches handrails. Great video.",
  },
  {
    videoIndex: 10,
    body: "A bicycle wheel to explain Oberth is the kind of thing that makes me subscribe.",
    pinned: true,
  },
  {
    videoIndex: 11,
    body: "Skim once and leave it alone is advice I needed five years ago",
  },
  {
    videoIndex: 12,
    body: "gdb -c core and then bt is genuinely all most people need and nobody says it out loud",
  },
  {
    videoIndex: 13,
    body: "Straight from the phone and it still looks fine. Content over pixels.",
    replies: ["My laptop could not encode it so it went up as-is. Honestly no regrets."],
  },
  {
    videoIndex: 14,
    body: "Packing out what you would rather not is the part everybody skips.",
  },
  {
    videoIndex: 15,
    body: "The numbers really are tiny. A gram of force and it still works.",
  },
  {
    videoIndex: 16,
    body: "Tuning a self-oscillating filter is the single most frustrating thing in eurorack and you made it look easy",
    replies: ["It is not easy. That take was the eleventh."],
  },
  {
    videoIndex: 17,
    body: "Burr. I never knew to feel for the burr. Ten years of bad edges explained.",
    hearted: true,
  },
  {
    videoIndex: 18,
    body: "twenty seconds and it actually worked",
  },
  {
    videoIndex: 19,
    body: "arguing with my mother about this at christmas, sending her this",
  },
  {
    videoIndex: 20,
    body: "one cable. incredible.",
  },
  {
    videoIndex: 22,
    body: "bisect run changed my life, no exaggeration",
  },
];

/* ========================================================= view counts == */

/**
 * A power-law view count for a video at rank `rank` (0 = most viewed).
 *
 * `top / (rank + 1) ** exponent`, which is Zipf. A uniform draw between two
 * bounds — the obvious thing — produces a corpus where every video has roughly
 * the same view count, and the home feed's popularity ordering then looks
 * arbitrary because it is. Real catalogues are the other shape entirely: a
 * couple of videos carry most of the views and the long tail is in the
 * hundreds, which is exactly what makes "sort by views" a meaningful control.
 *
 * The exponent is a judgement, not a measurement. 1.55 puts the top video at
 * roughly a million and the twentieth at a few thousand across this corpus,
 * which is the spread a small channel network actually has.
 */
export const VIEW_ZIPF_EXPONENT = 1.55;
export const VIEW_TOP_COUNT = 1_180_000;

export function zipfViews(rank: number, jitter: number): number {
  const base = VIEW_TOP_COUNT / Math.pow(rank + 1, VIEW_ZIPF_EXPONENT);
  // ±18% so the curve is not visibly a formula, applied multiplicatively so it
  // does not flatten the tail.
  return Math.max(37, Math.round(base * (0.82 + jitter * 0.36)));
}

/* ============================================================== build == */

export interface BuildCorpusOptions {
  readonly seed?: number;
  /** The corpus's "now", in milliseconds. Defaults to {@link CORPUS_EPOCH_MS}. */
  readonly nowMs?: number;
}

/**
 * The corpus, built once from a seed.
 *
 * Read the draw order as a sequence: people, channels, videos, comments,
 * reactions, subscriptions, sessions, playlists, progress. Inserting a new
 * `rng()` call anywhere shifts everything after it, which is why the sections
 * are separated and why the test asserts a whole-corpus digest rather than
 * spot values — a digest fails on any reordering, and a spot check does not.
 */
export function buildCorpus(options: BuildCorpusOptions = {}): Corpus {
  const seed = options.seed ?? CORPUS_SEED;
  const nowMs = options.nowMs ?? CORPUS_EPOCH_MS;
  const rng = mulberry32(seed);
  const draw = draws(rng);

  /* ------------------------------------------------------------ people -- */

  const people: CorpusPerson[] = [];
  for (const channel of CHANNEL_SOURCE) {
    people.push({
      key: `owner:${channel.key}`,
      displayName: channel.owner,
      email: `${channel.handle}@seed.invalid`,
      // A shared password across the corpus, because the corpus is a fixture
      // and the interesting property is that it is written down here rather
      // than guessable from a name. `.invalid` is RFC 2606's reserved TLD, so
      // none of these addresses can ever resolve.
      password: SEED_PASSWORD,
      handle: channel.handle,
    });
  }
  VIEWER_NAMES.forEach((displayName, index) => {
    people.push({
      key: `viewer:${index}`,
      displayName,
      email: `${displayName.toLowerCase().replace(/[^a-z]+/g, ".")}@seed.invalid`,
      password: SEED_PASSWORD,
    });
  });

  const viewerKeys = people
    .filter((person) => person.key.startsWith("viewer:"))
    .map((person) => person.key);

  /* ---------------------------------------------------------- channels -- */

  const channels: CorpusChannel[] = CHANNEL_SOURCE.map((source) => ({
    key: source.key,
    ownerKey: `owner:${source.key}`,
    handle: source.handle,
    name: source.name,
    description: source.description,
    palette: source.palette,
    monogram: source.monogram,
  }));
  const paletteOf = new Map(channels.map((channel) => [channel.key, channel.palette]));

  /* ------------------------------------------------------------ videos -- */

  // Ids first, in catalogue order, so that adding a comment later cannot move
  // them. Eleven characters, `nanoid`'s alphabet — see ID_ALPHABET.
  const ids = VIDEO_SOURCE.map(() => {
    let id = "";
    for (let i = 0; i < VIDEO_ID_LENGTH; i++) {
      id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)];
    }
    return id;
  });

  // Popularity rank is a shuffle of the catalogue order rather than the order
  // itself: a corpus whose newest video is always its most-viewed makes "sort
  // by views" and "sort by date" the same list, and hides any bug in either.
  const rankOrder = draw.shuffle(ids.map((_, index) => index));
  const rankOf = new Map(rankOrder.map((videoIndex, rank) => [videoIndex, rank]));

  const videos: CorpusVideo[] = VIDEO_SOURCE.map((source, index) => {
    const palette = paletteOf.get(source.channelKey);
    if (!palette) throw new Error(`Video "${source.title}" names no known channel.`);

    const rank = rankOf.get(index) ?? index;
    const viewCount = zipfViews(rank, rng());
    // Between 2.4% and 5.8% of viewers press like — the band real channels sit
    // in. Dislikes are a small fraction of likes, and both are display figures
    // rather than a count of `reactions` rows (see the note in `scripts/seed.ts`
    // about `videos.view_count` having no repository setter).
    const likeCount = Math.round(viewCount * draw.between(0.024, 0.058));
    const dislikeCount = Math.round(likeCount * draw.between(0.02, 0.09));

    // Spread over roughly ten months, newest first, with an uneven gap so the
    // relative-time formatter has hours, days, weeks and months to render.
    const ageDays = Math.pow(index / VIDEO_SOURCE.length, 1.7) * 300 + index * 0.4;
    const publishedAtMs =
      nowMs -
      Math.round(ageDays * DAY_MS) -
      Math.round(draw.between(0, 9) * HOUR_MS) -
      (index === 0 ? 0 : Math.round(draw.between(0, 55) * 60_000));

    const geometry = source.vertical === true ? VERTICAL : LANDSCAPE;
    const clip: ClipSpec = {
      width: geometry.width,
      height: geometry.height,
      durationSeconds: source.seconds,
      frameRate: CLIP_FRAME_RATE,
      visual: source.visual,
      palette,
      caption: source.title,
      phase: rng(),
      audio: audioFor(source, rng),
    };

    return {
      id: ids[index]!,
      channelKey: source.channelKey,
      title: source.title,
      description: source.description,
      category: source.category,
      tags: source.tags,
      pipeline: source.progressive === true ? "progressive" : "laddered",
      isVertical: source.vertical === true,
      publishedAtMs,
      viewCount,
      likeCount,
      dislikeCount,
      clip,
      // A third of the way in, so the poster frame is mid-motion rather than
      // the first frame every clip shares.
      thumbnailAtSeconds: Number((source.seconds * 0.34).toFixed(3)),
      previewStartSeconds: Number((source.seconds * 0.28).toFixed(3)),
      previewSeconds: Math.min(3, Math.max(2, Math.round(source.seconds * 0.2))),
    };
  });

  /* ---------------------------------------------------------- comments -- */

  const comments: CorpusComment[] = COMMENT_SOURCE.map((source) => {
    const video = videos[source.videoIndex];
    if (!video) {
      throw new Error(`Comment references video index ${source.videoIndex}, which does not exist.`);
    }
    // The window a thread can occupy: after the video went up, before the
    // corpus's now. A minute of headroom at each end so the first reply is
    // never simultaneous with the comment it answers.
    const openedAt = video.publishedAtMs + draw.int(4, 60 * 24 * 6) * 60_000;
    const createdAtMs = Math.min(openedAt, nowMs - 60_000);

    return {
      videoId: video.id,
      authorKey: draw.pick(viewerKeys),
      body: source.body,
      likeCount: Math.round(Math.pow(draw.between(0, 1), 2.4) * 4200),
      pinned: source.pinned === true,
      hearted: source.hearted === true,
      createdAtMs,
      replies: (source.replies ?? []).map((body, replyIndex) => ({
        // The first reply to a pinned or hearted thread is the creator
        // answering, which is what those threads look like in the product.
        authorKey:
          replyIndex === 0 && (source.pinned === true || source.hearted === true)
            ? `owner:${video.channelKey}`
            : draw.pick(viewerKeys),
        body,
        likeCount: Math.round(Math.pow(draw.between(0, 1), 3) * 900),
        createdAtMs: Math.min(
          createdAtMs + (replyIndex + 1) * draw.int(6, 60 * 30) * 60_000,
          nowMs - 30_000,
        ),
      })),
    };
  });

  /* --------------------------------------------------------- reactions -- */

  const reactions: CorpusReaction[] = [];
  for (const video of videos) {
    for (const viewerKey of viewerKeys) {
      const roll = rng();
      if (roll < 0.22) reactions.push({ viewerKey, videoId: video.id, value: 1 });
      else if (roll < 0.245) reactions.push({ viewerKey, videoId: video.id, value: -1 });
    }
  }

  /* ----------------------------------------------------- subscriptions -- */

  const subscriptions: CorpusSubscription[] = [];
  for (const channel of channels) {
    for (const viewerKey of viewerKeys) {
      const roll = rng();
      if (roll > 0.55) continue;
      subscriptions.push({
        subscriberKey: viewerKey,
        channelKey: channel.key,
        notifications: roll < 0.12 ? "all" : roll < 0.45 ? "personalised" : "none",
      });
    }
    // Creators watch each other. Two owners per channel, chosen from the
    // others, which is what gives the subscription feed cross-channel rows.
    for (const other of channels) {
      if (other.key === channel.key) continue;
      if (rng() < 0.34) {
        subscriptions.push({
          subscriberKey: other.ownerKey,
          channelKey: channel.key,
          notifications: "personalised",
        });
      }
    }
  }

  /* ---------------------------------------------------------- sessions -- */

  const sessions = buildSessions(videos, viewerKeys, draw, rng, nowMs);

  /* --------------------------------------------------------- playlists -- */

  const byChannel = (key: string) =>
    videos.filter((video) => video.channelKey === key && !video.isVertical);

  const playlists: CorpusPlaylist[] = [
    {
      ownerKey: "owner:stackframe",
      title: "Reading real code",
      description: "Every episode where we open somebody else's source and read it out loud.",
      visibility: "public",
      videoIds: byChannel("stackframe").map((video) => video.id),
    },
    {
      ownerKey: "owner:orbital",
      title: "Orbits from first principles",
      description: "In order. Each one assumes the one before it.",
      visibility: "public",
      videoIds: byChannel("orbital").map((video) => video.id),
    },
    {
      ownerKey: viewerKeys[0] ?? "viewer:0",
      title: "Weekend build queue",
      description: "Things to do when there is a whole Saturday.",
      visibility: "unlisted",
      videoIds: draw
        .shuffle(videos.filter((video) => !video.isVertical))
        .slice(0, 6)
        .map((video) => video.id),
    },
  ];

  /* ---------------------------------------------------------- progress -- */

  // Half-watched videos, so the "Continue watching" shelf and the red bar under
  // a card have something to draw. Restricted to the first few viewers so the
  // shelf is a handful of rows rather than the whole catalogue.
  const progress: CorpusProgress[] = [];
  for (const viewerKey of viewerKeys.slice(0, 4)) {
    for (const video of draw.shuffle(videos).slice(0, 5)) {
      const completed = rng() < 0.35;
      progress.push({
        viewerKey,
        videoId: video.id,
        positionSeconds: completed
          ? video.clip.durationSeconds
          : Number((video.clip.durationSeconds * draw.between(0.12, 0.78)).toFixed(2)),
        completed,
        updatedAtMs: nowMs - Math.round(draw.between(0.5, 96) * HOUR_MS),
      });
    }
  }

  /* --------------------------------------------------- the claim target -- */

  const passageVideos = VIDEO_SOURCE.map((source, index) => ({ source, index })).filter(
    (entry) => entry.source.passageAtSeconds !== undefined,
  );
  const origin = passageVideos[0];
  if (origin === undefined || passageVideos.length < 2) {
    throw new Error(
      "The Content ID demonstration needs at least two videos carrying the shared " +
        "passage; mark them with `passageAtSeconds` in VIDEO_SOURCE.",
    );
  }

  const referenceWork: CorpusReferenceWork = {
    title: "Ostinato in D — Patch Bay Sessions",
    rightsHolder: "The Patch Bay",
    // `monetise`, not `block`: a blocked seed video would be unplayable, and a
    // corpus whose demonstration of Content ID is a video nobody can watch
    // demonstrates the wrong half. `content-id.ts` is emphatic that a match
    // creates a claim and never a takedown.
    policy: "monetise",
    originVideoId: videos[origin.index]!.id,
    reuse: passageVideos.slice(1).map((entry) => ({
      videoId: videos[entry.index]!.id,
      atSeconds: entry.source.passageAtSeconds!,
    })),
    audio: sharedPassageSpec(),
    durationSeconds: SHARED_PASSAGE_SECONDS,
  };

  return {
    seed,
    nowMs,
    people,
    channels,
    videos,
    comments,
    subscriptions,
    reactions,
    sessions,
    playlists,
    progress,
    referenceWork,
  };
}

/** The password every seeded account shares. Fixtures, not secrets. */
export const SEED_PASSWORD = "seed-corpus-password-2026";

/* ============================================================ sessions == */

/**
 * Watch sessions, built so the co-visitation graph has real structure.
 *
 * The recommender only stores a pair once its weight reaches
 * `MIN_COVISIT_WEIGHT` (3, in `domain/recommender/covisitation.ts`), so
 * sessions drawn uniformly at random from twenty-four videos would produce a
 * `related_videos` table that is almost entirely empty and a sidebar that is
 * pure fallback ordering — which looks like a working recommender and is not
 * one. So sessions are drawn from *affinities*: a viewer who opens a modular
 * synthesis video is far more likely to open another one, and the pairs inside
 * an affinity therefore clear the floor many times over while cross-affinity
 * pairs mostly do not.
 *
 * A few sessions deliberately replay a video they have already watched.
 * `recordWatch`'s dedup rule is the single most commonly-missed piece of D10
 * (see the schema's own note on `session_videos`), and a corpus with no replays
 * in it cannot tell a correct implementation from one that counts every replay.
 */
function buildSessions(
  videos: readonly CorpusVideo[],
  viewerKeys: readonly string[],
  draw: Draw,
  rng: () => number,
  nowMs: number,
): CorpusSession[] {
  // Affinities are channel clusters that a person plausibly watches together:
  // the two technical channels, the two outdoor/physical ones, the two making
  // ones. Cross-cluster overlap comes from the tail draw below.
  const affinities: readonly (readonly string[])[] = [
    ["stackframe", "orbital"],
    ["field", "kitchen"],
    ["patchbay", "lumen"],
    ["lumen", "stackframe"],
    ["orbital", "field"],
    ["kitchen", "patchbay"],
  ];

  const sessions: CorpusSession[] = [];
  const SESSION_COUNT = 96;

  for (let index = 0; index < SESSION_COUNT; index++) {
    const affinity = draw.pick(affinities);
    const pool = videos.filter((video) => affinity.includes(video.channelKey));
    const others = videos.filter((video) => !affinity.includes(video.channelKey));

    const wanted = draw.int(3, 6);
    const chosen = draw.shuffle(pool).slice(0, wanted);
    // One in four sessions wanders out of its affinity, which is what stops the
    // graph from being six disconnected components and gives the two-hop
    // expansion in `recommendations.ts` something to reach.
    if (rng() < 0.25 && others.length > 0) chosen.push(draw.pick(others));

    const videoIds = chosen.map((video) => video.id);
    // Every eighth session replays its first video at the end. See the header.
    if (index % 8 === 3 && videoIds.length > 0) videoIds.push(videoIds[0]!);

    // Signed-in for two thirds of sessions: co-visitation has to work for a
    // signed-out viewer too, and the only way to prove it does is to have some.
    const signedIn = rng() < 0.66;

    sessions.push({
      key: `seed-session-${String(index).padStart(3, "0")}`,
      viewerKey: signedIn ? draw.pick(viewerKeys) : null,
      watchedAtMs: nowMs - Math.round(draw.between(0.25, 34) * DAY_MS),
      videoIds,
      watchedSeconds: videoIds.map((id) => {
        const video = videos.find((candidate) => candidate.id === id);
        const total = video?.clip.durationSeconds ?? 10;
        return Number((total * draw.between(0.35, 1)).toFixed(2));
      }),
    });
  }

  // Sorted by time so that `watch_events` is written in chronological order and
  // the history page reads like a history rather than like an insert log.
  return sessions.sort((a, b) => a.watchedAtMs - b.watchedAtMs || (a.key < b.key ? -1 : 1));
}

/* =============================================================== audio == */

/**
 * The soundtrack for one clip.
 *
 * Every clip gets a pulse and a short motif, both stated as frequencies rather
 * than as note names because {@link ToneEvent} is rendered by summing sines and
 * a note name would need a table nobody would keep in step. The two videos that
 * carry the Content ID passage get {@link sharedPassageEvents} spliced in at the
 * offset the catalogue names, unchanged — that identity is the whole point of
 * the claim path.
 */
function audioFor(source: VideoSource, rng: () => number): AudioSpec {
  const events: ToneEvent[] = [];
  const root = 174.61 * Math.pow(2, Math.floor(rng() * 4) / 12);
  const motifLength = Math.max(3, Math.round(source.seconds / 2.4));

  for (let i = 0; i < motifLength; i++) {
    // A pentatonic walk, so consecutive clips do not sound like a chromatic
    // test tone. Degrees in semitones from the root.
    const degrees = [0, 3, 5, 7, 10, 12];
    const degree = degrees[Math.floor(rng() * degrees.length)] ?? 0;
    const fundamental = root * Math.pow(2, degree / 12);
    events.push({
      startSeconds: (i * source.seconds) / motifLength,
      durationSeconds: (source.seconds / motifLength) * 1.4,
      partials: [fundamental, fundamental * 2, fundamental * 3.01],
      gain: 0.2 + rng() * 0.08,
    });
  }

  // Every draw above happens for every clip, in the same order, whether or not
  // the passage is spliced in. Filtering afterwards rather than skipping draws
  // is what keeps two corpora with different `passageAtSeconds` markers from
  // diverging in every id that follows.
  const pulseHz = 2 + Math.floor(rng() * 3);

  if (source.passageAtSeconds === undefined) {
    return { pulseHz, pulseGain: 0.16, events };
  }

  const from = source.passageAtSeconds;
  const to = from + SHARED_PASSAGE_SECONDS;
  return {
    pulseHz,
    pulseGain: 0.16,
    // The pulse ducks and the channel's own motif stops for the length of the
    // licensed passage — see `AudioSpec.pulseSilent` for the measurement that
    // made this necessary rather than merely tidy.
    pulseSilent: [{ startSeconds: from, endSeconds: to }],
    events: [
      ...events.filter((event) => event.startSeconds + event.durationSeconds <= from || event.startSeconds >= to),
      ...sharedPassageEvents(from),
    ],
  };
}

/**
 * The mono sample value at time `t`, for one audio spec.
 *
 * Pure and sample-rate independent, which is what lets the page render it at
 * 48 kHz for the AAC encoder and Node render the identical signal at 11 025 Hz
 * for the fingerprinter. Anything that consulted a sample index — a noise
 * generator keyed on `n`, an integrator — would break that and the Content ID
 * match would quietly fail to find audio it is looking at.
 *
 * The `channel` argument detunes the right channel by four cents, which is
 * enough to make the stereo image non-degenerate without moving a spectral peak
 * into a neighbouring bin: at 11 025 Hz with a 1024-point FFT a bin is 10.8 Hz
 * wide, and four cents on a 600 Hz partial is 1.4 Hz.
 */
export function audioSampleAt(spec: AudioSpec, t: number, channel: number): number {
  const detune = channel === 0 ? 1 : 1.0023;
  let value = 0;

  for (const event of spec.events) {
    const local = t - event.startSeconds;
    if (local < 0 || local >= event.durationSeconds) continue;
    // Attack-decay envelope, so each note has an onset. `research/06` §1.2
    // picks peaks from local maxima; a signal with no onsets gives a
    // constellation with no time structure to hash.
    const attack = Math.min(1, local / 0.012);
    const decay = Math.pow(1 - local / event.durationSeconds, 1.6);
    const envelope = attack * decay * event.gain;
    for (let p = 0; p < event.partials.length; p++) {
      const partial = event.partials[p]! * detune;
      // Higher partials quieter, which is what makes it read as an instrument
      // rather than as a stack of test tones.
      value += Math.sin(2 * Math.PI * partial * t) * envelope * (1 / (p + 1));
    }
  }

  const pulseDucked = (spec.pulseSilent ?? []).some(
    (window) => t >= window.startSeconds && t < window.endSeconds,
  );

  if (!pulseDucked && spec.pulseGain > 0 && spec.pulseHz > 0) {
    const period = 1 / spec.pulseHz;
    const local = t % period;
    if (local < 0.09) {
      const envelope = Math.pow(1 - local / 0.09, 3) * spec.pulseGain;
      value += Math.sin(2 * Math.PI * 1180 * t) * envelope;
      value += Math.sin(2 * Math.PI * 786 * t) * envelope * 0.6;
    }
  }

  // Soft clip rather than hard: a hard clip introduces broadband harmonics that
  // would put spectral peaks where the spec did not ask for any.
  return Math.tanh(value * 1.15) * 0.82;
}

/**
 * Render one channel of an audio spec to PCM.
 *
 * Shared by the page (48 kHz, two channels, fed to `AudioEncoder`) and by Node
 * (11 025 Hz, mono, fed to `domain/fingerprint`). One function, so the thing
 * being fingerprinted is provably the thing being encoded.
 */
export function renderAudioChannel(
  spec: AudioSpec,
  sampleRate: number,
  durationSeconds: number,
  channel: number,
): Float32Array {
  const count = Math.round(sampleRate * durationSeconds);
  const out = new Float32Array(count);
  for (let n = 0; n < count; n++) out[n] = audioSampleAt(spec, n / sampleRate, channel);
  return out;
}

/* ============================================================= digests == */

/**
 * A 32-bit FNV-1a digest of the corpus, for the determinism test.
 *
 * Hand-written and applied to `JSON.stringify` output because the property
 * being asserted is "these two objects are the same object", and a digest fails
 * on *any* difference — a reordered draw, a shifted timestamp, one extra
 * character in a title — where a handful of spot assertions would pass through
 * most of them. Exported so the seed script can print it, which makes the
 * corpus version visible in a log without printing the corpus.
 */
export function corpusDigest(corpus: Corpus): string {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(corpus);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
