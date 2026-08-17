/**
 * Adaptive bitrate: throughput estimation, rendition selection, and abandoning
 * an in-flight download that is going badly.
 *
 * The shape is the one `research/03-mse-player-abr.md` §6 recommends for our
 * conditions — hls.js's mechanism (a dual EWMA, asymmetric switch margins, and
 * mid-download abandonment) with dash.js's `InsufficientBufferRule` adopted as
 * the hard "never rebuffer" floor. BOLA and MPC were considered and rejected
 * there: their advantage is provable optimality *without* a trustworthy
 * throughput predictor, and since we are both client and origin our throughput
 * samples are exactly the low-noise single-origin case where a predictor is
 * trustworthy. We buy machinery we would not use.
 *
 * **Everything that decides anything in this file is a pure function of measured
 * state.** `selectRendition` and `shouldAbandon` take numbers and a ladder and
 * return a rendition; they do not read a clock, touch a `SourceBuffer` or know
 * that a browser exists. That is what makes the table of scenarios in
 * `__tests__/abr.test.ts` a real test of the algorithm rather than a test of a
 * mock. The only stateful thing here is `ThroughputEstimator`, and its state is
 * two floats that advance only when the caller hands it a completed download.
 *
 * Every constant is in `ABR_DEFAULTS`, named, and carries its provenance. They
 * are defaults rather than constants because §6's tunables table is explicit
 * that the right values depend on a deployment we do not control.
 */

/** One rung, as the selector sees it. Anything with an id and a bitrate fits. */
export interface AbrRendition {
  readonly id: string;
  /**
   * Bits per second. Use the playlist's `BANDWIDTH` (peak) rather than
   * `AVERAGE-BANDWIDTH`: every comparison below is against a throughput estimate
   * and asks "can the connection carry the worst segment", which the average
   * cannot answer.
   */
  readonly bitrate: number;
}

/* ----------------------------------------------------------------- config -- */

export interface AbrConfig {
  /** Half-life of the fast EWMA. hls.js `abrEwmaFastVoD = 3.0` (research §6). */
  readonly fastEwmaHalfLifeSeconds: number;
  /** Half-life of the slow EWMA. hls.js `abrEwmaSlowVoD = 9.0` (research §6). */
  readonly slowEwmaHalfLifeSeconds: number;
  /**
   * Floor on a sample's measured duration. hls.js's `minDelayMs = 50`
   * (research §6): a segment served from the HTTP cache can complete in under a
   * millisecond, and `bytes * 8 / 0.0004` is a throughput estimate of several
   * gigabits that would send the ladder straight to the top rung on a connection
   * that cannot carry it.
   */
  readonly minSampleMs: number;
  /**
   * Minimum accumulated EWMA weight before the estimate is trusted at all.
   * hls.js's `minWeight = 0.001` (research §6).
   */
  readonly minEwmaWeight: number;
  /**
   * How much of the estimate a rendition may consume before we drop off it.
   * research §6's `downSwitchSafetyFactor`. hls.js's equivalent `bwFactor` is
   * 0.95; §6 recommends 0.90 for us.
   */
  readonly downSwitchSafetyFactor: number;
  /**
   * How much of the estimate a rendition may consume before we climb onto it.
   * research §6's `upSwitchSafetyFactor` = 0.60, i.e. ~1.67x headroom demanded.
   * hls.js's equivalent `bwUpFactor` is 0.70.
   *
   * The gap between this and `downSwitchSafetyFactor` **is** the anti-oscillation
   * mechanism: between `estimate × 0.60` and `estimate × 0.90` a rung is too
   * expensive to climb onto and cheap enough to stay on, so a marginal estimate
   * jittering inside that band changes nothing. Narrowing the gap is how players
   * end up flapping between two rungs.
   */
  readonly upSwitchSafetyFactor: number;
  /**
   * Below this much buffered runway, force the lowest rung regardless of
   * throughput. research §6's `bufferLowSeconds = 6` — three of our 2s segments.
   */
  readonly bufferLowSeconds: number;
  /**
   * At or above this much runway, the `InsufficientBufferRule` stops applying and
   * throughput alone governs. research §6's `bufferHighSeconds = 20`.
   */
  readonly bufferHighSeconds: number;
  /**
   * Segments that must elapse between one upswitch and the next. research §6's
   * `antiThrashSegments = 2`.
   */
  readonly antiThrashSegments: number;
  /**
   * How often the engine re-runs `shouldAbandon` on an in-flight download.
   * research §6's `abandonPollIntervalMs = 200` — 2s segments do not need
   * hls.js's 100ms.
   */
  readonly abandonPollIntervalMs: number;
  /**
   * Runway, in segment durations, that must remain after the download would
   * finish. research §6's `abandonSafetyMarginSegments = 0.5`.
   */
  readonly abandonSafetyMarginSegments: number;
  /**
   * **Not from the research — a guard added here.** A projection from the first
   * few bytes of a response is dominated by connection setup: TLS, the request
   * round trip and TCP slow start all land inside the first couple of hundred
   * milliseconds, and a rate computed across them reads as a collapse. Two poll
   * intervals is the shortest window that is mostly transfer.
   */
  readonly abandonMinElapsedMs: number;
}

export const ABR_DEFAULTS: AbrConfig = {
  fastEwmaHalfLifeSeconds: 3.0,
  slowEwmaHalfLifeSeconds: 9.0,
  minSampleMs: 50,
  minEwmaWeight: 0.001,
  downSwitchSafetyFactor: 0.9,
  upSwitchSafetyFactor: 0.6,
  bufferLowSeconds: 6,
  bufferHighSeconds: 20,
  antiThrashSegments: 2,
  abandonPollIntervalMs: 200,
  abandonSafetyMarginSegments: 0.5,
  abandonMinElapsedMs: 400,
};

function withDefaults(config: Partial<AbrConfig> | undefined): AbrConfig {
  return config === undefined ? ABR_DEFAULTS : { ...ABR_DEFAULTS, ...config };
}

/* ------------------------------------------------------------------- ewma -- */

/**
 * An exponentially weighted moving average over samples that carry a weight.
 *
 * This is hls.js's `EWMA` (research §6, reference 19), reproduced rather than
 * invented, including the `zeroFactor` correction in `value()`. That correction
 * is the part that is easy to leave out and expensive to leave out: the average
 * starts at 0, so without it the first sample of a 10 Mbps connection reads as
 * roughly 2 Mbps and the player spends its first several segments climbing out
 * of a hole it dug at startup. Dividing by `1 - alpha^totalWeight` removes
 * exactly the weight the not-yet-real zero is still holding.
 *
 * Weights are seconds of download time, so a 4-second download moves the average
 * four times as far as a 1-second one — which is right, because it is four times
 * as much evidence.
 */
export class Ewma {
  private readonly alpha: number;
  private estimate = 0;
  private totalWeight = 0;

  constructor(halfLifeSeconds: number) {
    if (!(halfLifeSeconds > 0)) {
      throw new Error(`An EWMA half-life must be positive, not ${halfLifeSeconds}`);
    }
    // alpha is the retention per unit of weight: after `halfLifeSeconds` of
    // weight, exactly half the old estimate remains.
    this.alpha = Math.exp(Math.log(0.5) / halfLifeSeconds);
  }

  update(value: number, weight = 1): void {
    const adjusted = Math.pow(this.alpha, weight);
    this.estimate = value * (1 - adjusted) + adjusted * this.estimate;
    this.totalWeight += weight;
  }

  get weight(): number {
    return this.totalWeight;
  }

  get value(): number {
    const zeroFactor = 1 - Math.pow(this.alpha, this.totalWeight);
    return zeroFactor === 0 ? 0 : this.estimate / zeroFactor;
  }
}

/**
 * Two EWMAs at different half-lives, reported as their minimum.
 *
 * The asymmetry is the point (research §6): the fast average reacts to a
 * bandwidth *drop* within a segment or two so quality falls before the buffer
 * does, and the slow one holds back a *rise* so a single fast segment does not
 * pull the ladder up onto a rung the connection cannot sustain. Taking the
 * minimum means the pessimistic reading always wins, which is the behaviour
 * viewers experience as "it never stalls" rather than "it looks great sometimes".
 *
 * Stateful, but the state is two floats and it only advances when a caller hands
 * over a completed download. No clock is read here — `elapsedMs` is measured by
 * whoever did the fetching, which keeps this testable with literals.
 */
export class ThroughputEstimator {
  private readonly fast: Ewma;
  private readonly slow: Ewma;
  private readonly config: AbrConfig;
  private samples = 0;

  constructor(config: Partial<AbrConfig> = {}) {
    this.config = withDefaults(config);
    this.fast = new Ewma(this.config.fastEwmaHalfLifeSeconds);
    this.slow = new Ewma(this.config.slowEwmaHalfLifeSeconds);
  }

  onSegmentDownloaded(bytes: number, elapsedMs: number): void {
    if (!(bytes > 0)) return;
    const clampedMs = Math.max(elapsedMs, this.config.minSampleMs);
    const seconds = clampedMs / 1000;
    this.fast.update((bytes * 8) / seconds, seconds);
    this.slow.update((bytes * 8) / seconds, seconds);
    this.samples += 1;
  }

  get sampleCount(): number {
    return this.samples;
  }

  /** `null` until there is enough evidence — the caller must then use the startup probe. */
  estimateBps(): number | null {
    if (this.fast.weight < this.config.minEwmaWeight) return null;
    return Math.min(this.fast.value, this.slow.value);
  }
}

/* -------------------------------------------------------------- selection -- */

export type AbrReason =
  /** A manual quality pick is in force; nothing else was consulted. */
  | "pinned"
  /** No throughput sample yet, so the lowest rung is fetched to measure one. */
  | "startup-probe"
  /** Buffer below `bufferLowSeconds`: the lowest rung, whatever throughput says. */
  | "buffer-floor"
  /** Chosen freely by throughput. */
  | "throughput"
  /** Capped by the `InsufficientBufferRule` — the runway, not the pipe, was the limit. */
  | "insufficient-buffer"
  /** A higher rung fits `downSwitchSafetyFactor` but not `upSwitchSafetyFactor`. */
  | "held-headroom"
  /** A higher rung is affordable but the last upswitch was too recent. */
  | "held-anti-thrash";

export interface AbrDecision {
  readonly rendition: AbrRendition;
  readonly reason: AbrReason;
  /**
   * The bitrate ceiling the choice was made under, in bps, or `null` before the
   * first sample. Carried out so a log line explains a decision without the
   * reader re-deriving it.
   */
  readonly ceilingBps: number | null;
}

export interface AbrInput {
  /** Any order; sorted here. Must be non-empty. */
  readonly ladder: readonly AbrRendition[];
  /** What is playing now, or `null` before anything has been chosen. */
  readonly currentRenditionId: string | null;
  /** `ThroughputEstimator.estimateBps()`. `null` triggers the startup probe. */
  readonly throughputBps: number | null;
  /** Forward runway from `currentTime`, in seconds. Zero when seeking into a gap. */
  readonly bufferSeconds: number;
  readonly segmentDurationSeconds: number;
  /** Segments completed since the last upswitch. Large before the first one. */
  readonly segmentsSinceUpSwitch: number;
  /**
   * A manual pick. `null` means Auto.
   *
   * When set, this short-circuits everything below (research §7): the pin is a
   * hard constraint, not a preference, and the player rebuffers *at* the pinned
   * quality rather than silently overriding an explicit choice. The throughput
   * machinery keeps running underneath for telemetry — it just does not decide.
   */
  readonly pinnedRenditionId?: string | null;
  readonly config?: Partial<AbrConfig>;
}

function ascending(ladder: readonly AbrRendition[]): readonly AbrRendition[] {
  return [...ladder].sort((a, b) => a.bitrate - b.bitrate);
}

/** The highest rung at or under a ceiling, or `null` if even the lowest exceeds it. */
function highestUnder(
  sorted: readonly AbrRendition[],
  ceilingBps: number,
): AbrRendition | null {
  let best: AbrRendition | null = null;
  for (const rendition of sorted) {
    if (rendition.bitrate <= ceilingBps) best = rendition;
    else break;
  }
  return best;
}

/**
 * Which rung to fetch the next segment at.
 *
 * The order of the rules is load-bearing and follows dash.js's composition
 * (research §6): a throughput-derived candidate is proposed, and every other
 * rule may only pull it *down*. Nothing below can force a climb, which is why a
 * bug in one guardrail degrades quality rather than causing a stall.
 *
 * **One deliberate departure from the research's pseudocode.** §6 ends with
 *
 *     if bufferSeconds >= BUFFER_HIGH:
 *         candidate = highest rendition where bitrate <= throughputEstimate * UP_SAFETY
 *
 * which re-derives the candidate using the *up* factor as a *down* threshold.
 * Applied to a player already on a rung, that forces a downswitch the moment
 * `bitrate > estimate × 0.60` — so a 2.8 Mbps rung is abandoned at a measured
 * 4.5 Mbps, on a full buffer, purely because the buffer is healthy. Worse, it
 * un-does the hysteresis the two factors exist to create, which is precisely the
 * flapping §6 is trying to prevent everywhere else. Read against the tunables
 * table, which describes `bufferHighSeconds` as the point where "throughput
 * governs freely", the intent is clearly that the buffer rule stops constraining
 * — so that is what is implemented: above `bufferHighSeconds` the
 * `InsufficientBufferRule` cap is dropped and the asymmetric margins alone
 * decide. The oscillation case in `__tests__/abr.test.ts` is the regression test
 * for it.
 */
export function selectRendition(input: AbrInput): AbrDecision {
  const config = withDefaults(input.config);
  const sorted = ascending(input.ladder);
  const lowest = sorted[0];
  if (lowest === undefined) {
    throw new Error("selectRendition needs a ladder with at least one rendition");
  }

  const pinnedId = input.pinnedRenditionId ?? null;
  if (pinnedId !== null) {
    const pinned = sorted.find((r) => r.id === pinnedId);
    // A pin naming a rung this asset does not have is a caller bug, but failing
    // playback over it would be worse than falling back to Auto, so it falls
    // through into the normal path rather than throwing.
    if (pinned !== undefined) {
      return { rendition: pinned, reason: "pinned", ceilingBps: null };
    }
  }

  const throughput = input.throughputBps;
  if (throughput === null || !(throughput > 0)) {
    // research §6: rather than seeding a hardcoded default estimate and choosing
    // from it, the first segment is fetched at the lowest rung *specifically to
    // measure*. hls.js does the same thing (`testBandwidth`) and for the same
    // reason — a guess that is too high stalls immediately, and one that is too
    // low wastes a fast connection for the whole first buffer window.
    return { rendition: lowest, reason: "startup-probe", ceilingBps: null };
  }

  if (input.bufferSeconds < config.bufferLowSeconds) {
    return { rendition: lowest, reason: "buffer-floor", ceilingBps: null };
  }

  const current = sorted.find((r) => r.id === input.currentRenditionId) ?? null;

  const downCeiling = throughput * config.downSwitchSafetyFactor;
  // dash.js's InsufficientBufferRule, verbatim (research §6): never pick a
  // rendition whose expected download time would exceed the runway already
  // buffered.
  //
  // **At our recommended defaults this rule can never bind, and that is worth
  // stating rather than discovering.** It only constrains when
  // `bufferSeconds < segmentDurationSeconds`, since below that the multiplier
  // drops under one — and `bufferLowSeconds = 6` has already forced the lowest
  // rung by then, which is strictly stronger. So with 2s segments the rule is
  // dominated by the floor above it and contributes nothing.
  //
  // It stays because both terms are tunable and neither is ours to fix: a
  // deployment that drops `bufferLowSeconds` toward one segment, or one that
  // packages 6s segments, puts the rule back in play immediately — and it is the
  // rule with the right *shape* for that regime, where the floor is a blunt
  // instrument. `__tests__/abr.test.ts` exercises it at such a configuration, so
  // it is covered code rather than decorative code.
  const sustainableCeiling =
    (throughput * config.downSwitchSafetyFactor * input.bufferSeconds) /
    input.segmentDurationSeconds;

  const bufferGoverns = input.bufferSeconds < config.bufferHighSeconds;
  const ceiling = bufferGoverns ? Math.min(downCeiling, sustainableCeiling) : downCeiling;

  const candidate = highestUnder(sorted, ceiling) ?? lowest;
  const cappedByBuffer = bufferGoverns && sustainableCeiling < downCeiling;

  if (current === null || candidate.bitrate <= current.bitrate) {
    return {
      rendition: candidate,
      reason: cappedByBuffer && candidate.bitrate < (current?.bitrate ?? Infinity)
        ? "insufficient-buffer"
        : "throughput",
      ceilingBps: ceiling,
    };
  }

  // Everything from here is an upswitch, and an upswitch has to clear two extra
  // gates that a downswitch does not. Quality drops fast and climbs cautiously.
  const upCeiling = throughput * config.upSwitchSafetyFactor;
  if (candidate.bitrate > upCeiling) {
    return { rendition: current, reason: "held-headroom", ceilingBps: upCeiling };
  }
  if (input.segmentsSinceUpSwitch < config.antiThrashSegments) {
    return { rendition: current, reason: "held-anti-thrash", ceilingBps: upCeiling };
  }

  // Multi-rung jumps are deliberate. research §6: "Ramp-up should not be forced
  // to one rung per step in either direction" — single-stepping makes a fast
  // connection feel sluggish and, on the way down, makes a bandwidth cliff take
  // several segment boundaries to react to, which is where the stall comes from.
  const reachable = highestUnder(sorted, upCeiling) ?? candidate;
  const chosen = reachable.bitrate < candidate.bitrate ? reachable : candidate;
  return { rendition: chosen, reason: "throughput", ceilingBps: upCeiling };
}

/** The rung the startup probe fetches: the lowest, always. See `selectRendition`. */
export function startupRendition(ladder: readonly AbrRendition[]): AbrRendition {
  const lowest = ascending(ladder)[0];
  if (lowest === undefined) {
    throw new Error("startupRendition needs a ladder with at least one rendition");
  }
  return lowest;
}

/* ------------------------------------------------------------ abandonment -- */

export type AbandonHoldReason =
  /** Too early in the response for a rate to mean anything. */
  | "too-early"
  /** No `Content-Length`, so there is no remaining-bytes figure to project from. */
  | "unknown-size"
  /** The download will finish with runway to spare. */
  | "on-track"
  /** Already on the lowest rung: restarting would fetch the same bytes again. */
  | "already-lowest";

export type AbandonDecision =
  | { readonly abandon: false; readonly reason: AbandonHoldReason }
  | {
      readonly abandon: true;
      /** Restart the *same* segment index at this rung. */
      readonly restart: AbrRendition;
      readonly observedBps: number;
      readonly projectedRemainingSeconds: number;
    };

export interface AbandonInput {
  readonly ladder: readonly AbrRendition[];
  readonly currentRenditionId: string;
  readonly bytesReceived: number;
  /** From `Content-Length`. `null` when the response did not declare one. */
  readonly expectedTotalBytes: number | null;
  readonly elapsedMs: number;
  readonly bufferSeconds: number;
  readonly segmentDurationSeconds: number;
  readonly config?: Partial<AbrConfig>;
}

/**
 * Should this in-flight download be abandoned and restarted lower?
 *
 * The value of this rule is entirely in *when* it fires: without it, a segment
 * that is going to take twelve seconds on a four-second buffer is discovered to
 * be a problem only when it finishes, which is several seconds after the viewer
 * has already seen the spinner. hls.js's `_abandonRulesCheck` and dash.js's
 * `AbandonRequestRule` are the same idea (research §6); this is the same
 * projection, polled at `abandonPollIntervalMs` because our segments are 2s and
 * do not need hls.js's 100ms.
 *
 * Two guards that the research's pseudocode does not have, both of which are
 * bugs if left out:
 *
 *  - **Never abandon on the lowest rung.** The pseudocode restarts at "the
 *    highest rendition the observed throughput can sustain", which on the lowest
 *    rung is the lowest rung — so the same segment is fetched again on the same
 *    bad connection, is again projected to overrun, and is abandoned again. That
 *    is a loop that transfers bytes forever and plays nothing.
 *  - **The restart rung must be strictly below the current one.** When the
 *    buffer is nearly empty, `observedBps × 0.9` can still clear the current
 *    rung's bitrate — the pipe is fine, the runway is not — and the pseudocode
 *    would then "restart" at the rung it just abandoned.
 */
export function shouldAbandon(input: AbandonInput): AbandonDecision {
  const config = withDefaults(input.config);
  const sorted = ascending(input.ladder);
  const lowest = sorted[0];
  if (lowest === undefined) {
    throw new Error("shouldAbandon needs a ladder with at least one rendition");
  }

  const current = sorted.find((r) => r.id === input.currentRenditionId) ?? lowest;
  if (current.bitrate <= lowest.bitrate) {
    return { abandon: false, reason: "already-lowest" };
  }
  if (input.elapsedMs < config.abandonMinElapsedMs || input.bytesReceived <= 0) {
    return { abandon: false, reason: "too-early" };
  }
  if (input.expectedTotalBytes === null) {
    return { abandon: false, reason: "unknown-size" };
  }

  const remainingBytes = input.expectedTotalBytes - input.bytesReceived;
  if (remainingBytes <= 0) return { abandon: false, reason: "on-track" };

  const observedBps = (input.bytesReceived * 8) / (input.elapsedMs / 1000);
  const projectedRemainingSeconds = (remainingBytes * 8) / observedBps;
  const deadlineSeconds =
    input.bufferSeconds - input.segmentDurationSeconds * config.abandonSafetyMarginSegments;

  if (projectedRemainingSeconds <= deadlineSeconds) {
    return { abandon: false, reason: "on-track" };
  }

  // research §6: use the partial sample rather than discarding it — restart at
  // the highest rung the *observed* throughput sustains, not reflexively at the
  // bottom, so one slow segment does not cost a minute of 144p.
  //
  // Three cases, and the middle one is the interesting one:
  //  - nothing on the ladder fits the observed rate → the bottom rung, because
  //    the connection genuinely cannot carry anything else right now;
  //  - something fits and it is below what we are on → take it, however far down;
  //  - something fits but it is *at or above* what we are on → the pipe is fine
  //    and the runway is not, so step down exactly one rung rather than
  //    "restarting" at the rendition we just gave up on.
  const affordable = highestUnder(sorted, observedBps * config.downSwitchSafetyFactor);
  const below = sorted.filter((r) => r.bitrate < current.bitrate);
  const oneRungDown = below[below.length - 1] ?? lowest;
  const restart =
    affordable === null
      ? lowest
      : affordable.bitrate < current.bitrate
        ? affordable
        : oneRungDown;

  return { abandon: true, restart, observedBps, projectedRemainingSeconds };
}
