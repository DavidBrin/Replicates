/**
 * The live-stream simulation.
 *
 * Same shape of decision as `call-session.ts`: a pure step function over
 * injected randomness rather than a class that owns timers. Three things fall
 * out of it:
 *
 *   - the whole simulation is unit-testable with no timers and no browser;
 *   - the randomness is *reproducible* — the seed is part of the state, so a
 *     failing "the viewer count did something silly" report can be replayed
 *     exactly instead of being chased through a live stream of `Math.random()`;
 *   - the React layer owns nothing but a `setInterval` that feeds a delta in,
 *     so a throttled background tab (which mobile Safari WILL do to us —
 *     research/web-platform-constraints.md §2) resumes cleanly rather than
 *     dumping two minutes of backlogged comments on screen at once.
 *
 * Everything a bystander is meant to read at a glance lives here: a viewer
 * count that drifts, and a comment stream that never sounds like a metronome.
 * research/instagram-live-ui.md §0 is explicit that these two are what sell the
 * illusion, and §3/§7 that the *pattern* — not any Instagram-specific asset —
 * is what we are replicating.
 */

/* ------------------------------------------------------------------ rng -- */

export interface RandomStep {
  /** In `[0, 1)`. */
  readonly value: number;
  /** Feed this back in for the next draw. */
  readonly seed: number;
}

/**
 * mulberry32, written as a pure step instead of a closure.
 *
 * A closure-based PRNG would hide mutable state inside the session and make
 * `tickLiveSession` impure; carrying the seed in the state instead means the
 * same `(state, delta)` always produces the same next state, which is what the
 * tests assert. It is thirty-two bits of statistical quality, which is far more
 * than "how many people joined the stream in the last two seconds" needs, and
 * it costs no dependency.
 */
export function nextRandom(seed: number): RandomStep {
  const nextSeed = (seed + 0x6d2b79f5) | 0;
  let t = nextSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296, seed: nextSeed };
}

/**
 * The same generator as a closure, for callers that are not themselves pure —
 * the floating-hearts layer, which is decoration and has no state worth
 * replaying, but still must not call `Math.random()` during a React render.
 */
export function createSeededRandom(seed: number): () => number {
  let current = seed | 0;
  return () => {
    const step = nextRandom(current);
    current = step.seed;
    return step.value;
  };
}

function randomInt(seed: number, minInclusive: number, maxInclusive: number): RandomStep {
  const step = nextRandom(seed);
  const span = maxInclusive - minInclusive + 1;
  return {
    value: minInclusive + Math.floor(step.value * span),
    seed: step.seed,
  };
}

function pickIndex(seed: number, length: number): RandomStep {
  return randomInt(seed, 0, Math.max(0, length - 1));
}

/* ----------------------------------------------------------- camera fail -- */

/**
 * Why the camera did not start.
 *
 * This union lives in `domain/` rather than in the camera adapter on purpose:
 * the live screen has to say something *specific* and useful ("you blocked the
 * camera" reads very differently from "this browser has no camera API"), and a
 * component may never import an adapter (SPEC §3.1). Domain is the one module
 * both layers are allowed to share, so the vocabulary lives here and the
 * adapter's error carries one of these codes.
 */
export type CameraFailureCode =
  | "unsupported"
  | "insecure_context"
  | "denied"
  | "no_device"
  | "in_use"
  | "single_camera"
  | "aborted"
  | "unknown";

const CAMERA_FAILURE_CODES: ReadonlySet<string> = new Set<CameraFailureCode>([
  "unsupported",
  "insecure_context",
  "denied",
  "no_device",
  "in_use",
  "single_camera",
  "aborted",
  "unknown",
]);

/**
 * Classifies whatever `getUserMedia` rejected with.
 *
 * Pure string inspection of a `DOMException`'s `name`, so it is testable
 * without a browser and lives here rather than in the adapter. The names are
 * the ones the Media Capture spec defines; Safari and Chrome disagree about
 * which of them they use for a *blocked-at-the-OS-level* camera, so both
 * `NotAllowedError` and `SecurityError` map to "denied" — telling the user to
 * check their browser permissions is the right advice either way.
 */
export function classifyCameraError(error: unknown): CameraFailureCode {
  const name =
    typeof error === "object" && error !== null ? String(Reflect.get(error, "name")) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no_device";
    case "NotReadableError":
    case "TrackStartError":
      return "in_use";
    case "AbortError":
      return "aborted";
    default:
      return "unknown";
  }
}

/**
 * Reads the failure code back off a rejected promise.
 *
 * Structural rather than an `instanceof` check: the component that renders the
 * error must not import the adapter that threw it, and an `instanceof` across
 * that boundary would also break the moment the error crosses a bundle
 * boundary. Anything unrecognised is "unknown", which still renders a sane
 * screen — never a blank one.
 */
export function readCameraFailure(error: unknown): CameraFailureCode {
  if (typeof error === "object" && error !== null) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && CAMERA_FAILURE_CODES.has(code)) {
      return code as CameraFailureCode;
    }
  }
  return classifyCameraError(error);
}

/* ------------------------------------------------------------- comments -- */

export type LiveCommentKind = "comment" | "system";

export interface LiveComment {
  /** Stable React key; monotonic for the lifetime of the session. */
  readonly id: string;
  readonly kind: LiveCommentKind;
  readonly username: string;
  readonly text: string;
  /** 0–359. Deterministic per username, so one person keeps one avatar colour. */
  readonly avatarHue: number;
  /** `state.elapsedMs` at the moment it arrived; drives the fade-out. */
  readonly at: number;
}

/**
 * The comment pool.
 *
 * Deliberately warm, mundane and non-specific. Two reasons beyond taste: this
 * is a safety tool whose whole deterrent is "friendly people are watching
 * this", and any comment that reads as hostile, sexual or targeted would be
 * put on screen by us, unprompted, in front of a stranger. None of these are
 * real handles or real quotes.
 */
export const LIVE_COMMENT_MESSAGES: readonly string[] = [
  "hey!!",
  "hiii",
  "where are you rn",
  "we can hear you",
  "wave!!",
  "just got here",
  "how long are you live for",
  "the light looks nice",
  "haha",
  "no wayyy",
  "same",
  "on my way now",
  "text me after",
  "still here",
  "sound is fine on my end",
  "say hi to everyone",
  "i can see you",
  "hi from work",
  "keep going",
  "how far off are you",
  "yes!!",
  "watching",
  "hello hello",
  "you good?",
  "almost there?",
  "❤️",
  "😂",
  "waiting up",
];

/**
 * Generic handles. Invented, lowercase, deliberately unremarkable — nothing
 * that resembles a real account, and nothing that names a real person.
 */
export const LIVE_COMMENT_USERNAMES: readonly string[] = [
  "maya_lt",
  "tomsphotos",
  "j.okafor",
  "sam_dw",
  "nadia.k",
  "priya__b",
  "elle.marks",
  "o.mensah",
  "chris_b",
  "zoealix",
  "danny.ok",
  "ruth_iles",
  "kai.mtl",
  "noor_h",
  "bea.travels",
  "leo_nunes",
  "sofie.k",
  "raj_p",
  "milly.ann",
  "hen.rivers",
];

/**
 * The join-notice copy.
 *
 * research/instagram-live-ui.md §3 is explicit that join notices exist but that
 * **no source gives the exact string**, and that the wording has changed across
 * app versions. This is therefore a *chosen default*, not a verified string —
 * it is one of the two forms the research offers, picked for consistency. Do
 * not treat it as replicated copy.
 */
export const LIVE_JOIN_MESSAGE = (username: string): string => `${username} joined this live video`;

/* --------------------------------------------------------------- session -- */

export interface LiveSessionConfig {
  /** From `settings.live.viewers`. */
  readonly startingViewers: number;
  /** From `settings.live.commentsPerMinute`. Zero disables the stream. */
  readonly commentsPerMinute: number;
  /** The broadcaster's own handle, so the simulation never comments as them. */
  readonly username: string;
}

export interface LiveSessionState {
  readonly viewers: number;
  readonly comments: readonly LiveComment[];
  /** Simulated time since the stream started. */
  readonly elapsedMs: number;
  readonly seed: number;
  /** Countdown to the next comment. `Infinity` when the stream is disabled. */
  readonly nextCommentInMs: number;
  readonly nextViewerChangeInMs: number;
  readonly nextCommentId: number;
}

/** Mean gap between viewer-count changes. A live count that moves every frame
 * reads as a fake animation; roughly every couple of seconds reads as people. */
const VIEWER_STEP_MEAN_MS = 2_200;
/** Uniform jitter around that mean, as a fraction. */
const VIEWER_STEP_JITTER = 0.55;

/** P(someone joins) / P(someone leaves) on each viewer step; the remainder is
 * "nothing happened". Biased up, which is what a stream that is still gathering
 * an audience does — but only just, so the count never runs away. */
const VIEWER_JOIN_CHANCE = 0.55;
const VIEWER_LEAVE_CHANCE = 0.33;

/** Share of stream entries that are join notices rather than real comments. */
const SYSTEM_MESSAGE_CHANCE = 0.18;

/** Uniform jitter on the comment interval, as a fraction of the mean. Symmetric
 * on purpose: the mean interval is exactly `60000 / commentsPerMinute`, so the
 * configured rate is honoured while no two gaps are the same. A Poisson process
 * would be more "correct" but at low rates produces multi-second dead patches,
 * and research §0 says to err toward *more* motion in the lower third, not
 * less — a stalled comment stream is the thing that reads as fake. */
const COMMENT_INTERVAL_JITTER = 0.55;

/** How many comments to retain. The UI shows a handful; the rest is history we
 * would only leak memory holding on to during a long stream. */
const MAX_RETAINED_COMMENTS = 24;

/**
 * The largest slice of time a single tick will simulate.
 *
 * A tab that was hidden for two minutes comes back with a two-minute delta.
 * Playing all of it would post fifty comments in one frame and jump the viewer
 * count by hundreds — the single most obviously-fake thing this screen could
 * do. We drop the backlog and carry on.
 */
const MAX_CATCHUP_MS = 2_000;

export function createLiveSession(config: LiveSessionConfig, seed = 1): LiveSessionState {
  const viewers = Math.max(0, Math.floor(config.startingViewers || 0));
  const first = scheduleViewerStep(seed | 0);
  const second = scheduleComment(first.seed, config.commentsPerMinute);
  return {
    viewers,
    comments: [],
    elapsedMs: 0,
    seed: second.seed,
    // Both counters start pre-jittered so two sessions with adjacent seeds do
    // not fire their first event on the same frame.
    nextViewerChangeInMs: first.value,
    nextCommentInMs: second.value,
    nextCommentId: 1,
  };
}

/**
 * Advances the session by `deltaMs`.
 *
 * A zero or negative delta returns the *same object reference* — the identity
 * guarantee React needs to bail out of a re-render when a stray tick fires with
 * no time in it (a resumed background tab does exactly this).
 */
export function tickLiveSession(
  state: LiveSessionState,
  deltaMs: number,
  config: LiveSessionConfig,
): LiveSessionState {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const delta = Math.min(deltaMs, MAX_CATCHUP_MS);

  let seed = state.seed;
  let viewers = state.viewers;
  let comments = state.comments;
  let nextCommentId = state.nextCommentId;
  const elapsedMs = state.elapsedMs + delta;

  let viewerCountdown = state.nextViewerChangeInMs - delta;

  while (viewerCountdown <= 0) {
    const step = stepViewers(viewers, seed);
    seed = step.seed;
    viewers = step.viewers;
    const schedule = scheduleViewerStep(seed);
    seed = schedule.seed;
    viewerCountdown += schedule.value;
  }

  // A stream configured to zero comments per minute must produce none at all —
  // the setting exists so that someone can run live mode as a pure camera bluff
  // without text they did not choose appearing on their screen.
  let commentCountdown: number;
  if (config.commentsPerMinute <= 0) {
    commentCountdown = Number.POSITIVE_INFINITY;
  } else if (!Number.isFinite(state.nextCommentInMs)) {
    // The rate was just turned back on in settings; re-arm rather than staying
    // silent forever.
    const schedule = scheduleComment(seed, config.commentsPerMinute);
    seed = schedule.seed;
    commentCountdown = schedule.value;
  } else {
    commentCountdown = state.nextCommentInMs - delta;
    while (commentCountdown <= 0) {
      const entry = makeEntry(seed, config, elapsedMs, nextCommentId);
      seed = entry.seed;
      nextCommentId += 1;
      comments = [...comments, entry.comment].slice(-MAX_RETAINED_COMMENTS);
      const schedule = scheduleComment(seed, config.commentsPerMinute);
      seed = schedule.seed;
      commentCountdown += schedule.value;
    }
  }

  return {
    viewers,
    comments,
    elapsedMs,
    seed,
    nextViewerChangeInMs: viewerCountdown,
    nextCommentInMs: commentCountdown,
    nextCommentId,
  };
}

/**
 * The biggest single change the viewer count is allowed to make.
 *
 * Capped at three regardless of size: a count that ticks 148 → 151 reads as
 * three people arriving, while 148 → 187 reads as a script. Proportional below
 * that so a small stream moves one person at a time.
 */
export function maxViewerStep(viewers: number): number {
  return Math.max(1, Math.min(3, Math.round(Math.max(0, viewers) * 0.02)));
}

function stepViewers(viewers: number, seed: number): { viewers: number; seed: number } {
  const roll = nextRandom(seed);
  const cap = maxViewerStep(viewers);

  if (roll.value < VIEWER_JOIN_CHANCE) {
    const size = randomInt(roll.seed, 1, cap);
    return { viewers: viewers + size.value, seed: size.seed };
  }
  if (roll.value < VIEWER_JOIN_CHANCE + VIEWER_LEAVE_CHANCE) {
    const size = randomInt(roll.seed, 1, cap);
    // Never below zero: a negative audience is the sort of thing that only
    // shows up on someone else's phone, in a screenshot, forever.
    return { viewers: Math.max(0, viewers - size.value), seed: size.seed };
  }
  return { viewers, seed: roll.seed };
}

function scheduleViewerStep(seed: number): RandomStep {
  const roll = nextRandom(seed);
  const factor = 1 - VIEWER_STEP_JITTER + roll.value * VIEWER_STEP_JITTER * 2;
  return { value: VIEWER_STEP_MEAN_MS * factor, seed: roll.seed };
}

function scheduleComment(seed: number, commentsPerMinute: number): RandomStep {
  if (commentsPerMinute <= 0) return { value: Number.POSITIVE_INFINITY, seed };
  const mean = 60_000 / commentsPerMinute;
  const roll = nextRandom(seed);
  const factor = 1 - COMMENT_INTERVAL_JITTER + roll.value * COMMENT_INTERVAL_JITTER * 2;
  return { value: mean * factor, seed: roll.seed };
}

function makeEntry(
  seed: number,
  config: LiveSessionConfig,
  at: number,
  id: number,
): { comment: LiveComment; seed: number } {
  const kindRoll = nextRandom(seed);
  const isSystem = kindRoll.value < SYSTEM_MESSAGE_CHANCE;

  const nameRoll = pickIndex(kindRoll.seed, LIVE_COMMENT_USERNAMES.length);
  let username = LIVE_COMMENT_USERNAMES[nameRoll.value];
  if (username === config.username) {
    // The broadcaster never appears in their own comment stream. Cheap, but it
    // is exactly the detail that would be noticed if it ever happened.
    username = LIVE_COMMENT_USERNAMES[(nameRoll.value + 1) % LIVE_COMMENT_USERNAMES.length];
  }

  if (isSystem) {
    return {
      comment: {
        id: `live-${id}`,
        kind: "system",
        username,
        text: LIVE_JOIN_MESSAGE(username),
        avatarHue: hueFor(username),
        at,
      },
      seed: nameRoll.seed,
    };
  }

  const textRoll = pickIndex(nameRoll.seed, LIVE_COMMENT_MESSAGES.length);
  return {
    comment: {
      id: `live-${id}`,
      kind: "comment",
      username,
      text: LIVE_COMMENT_MESSAGES[textRoll.value],
      avatarHue: hueFor(username),
      at,
    },
    seed: textRoll.seed,
  };
}

/** Stable hue per handle, so an avatar does not change colour between comments. */
function hueFor(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i += 1) {
    hash = (Math.imul(hash, 31) + username.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/**
 * The slice of the stream that should currently be on screen.
 *
 * research/instagram-live-ui.md §3: three to five at once in quiet moments,
 * older ones fading out after a few seconds rather than persisting. Both
 * numbers are LOW-confidence in the research, so they are parameters with
 * sensible defaults rather than constants buried in the renderer.
 */
export function visibleComments(
  state: LiveSessionState,
  { limit = 5, lifetimeMs = 14_000 }: { limit?: number; lifetimeMs?: number } = {},
): readonly LiveComment[] {
  const cutoff = state.elapsedMs - lifetimeMs;
  const live = state.comments.filter((comment) => comment.at >= cutoff);
  return live.slice(-limit);
}
