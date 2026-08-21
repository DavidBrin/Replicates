/**
 * The signal chain and the meter taps (SPEC.md §3.4), built exactly as specced:
 *
 * ```
 * voice → channel GainNode (Channel.volume) → StereoPannerNode (Channel.pan)
 *       → mixer-track GainNode + StereoPannerNode (MixerTrack.volume/pan)
 *       → master GainNode + StereoPannerNode → DynamicsCompressorNode (limiter)
 *       → destination
 * ```
 *
 * Four things the diagram does not say, all decided here:
 *
 * - **Velocity is not in the channel gain.** §3.4 writes the channel gain as
 *   `Channel.volume·velocity`, but velocity is per-*note* and the channel gain
 *   is per-*channel* and shared by every ringing voice — folding velocity into
 *   it would retune notes already sounding. Velocity scales the voice's own
 *   envelope peak (`voices/shared.ts`), which is the same product at the same
 *   point in the chain, per note.
 * - **Mutes are ramped gains of 0**, never disconnections (§3.2's note on why
 *   muted channels still compile: un-muting mid-bar has to be instant).
 * - **Master is a strip like any other.** §3.4's diagram writes the master as a
 *   bare `GainNode`, but `MixerTrack` gives Master a `pan` the mixer surface
 *   renders and persists like every other strip's; without a panner on the
 *   chain that knob would move a saved number and nothing else. The panner sits
 *   *before* the limiter, so the limiter stays the last thing before the
 *   destination (its whole job).
 * - **Initial values are set, never ramped.** A newly built strip has no
 *   history to glide away from: ramping would start it at the node default of
 *   1 and reach the saved value {@link PARAM_RAMP_SEC} later, so a tick-zero
 *   note would sound through a muted channel at the wrong volume — in the live
 *   graph *and* in the offline export, where 20 ms is 20 ms of the actual file.
 *   Ramps are for *changes* (§3.3's click avoidance), which is what a strip
 *   that already exists is having.
 * - **Retiring a strip ramps it down first.** A channel delete or a project
 *   import can drop a strip while its voices are still ringing; disconnecting
 *   under a ringing voice is the hard cut §3.3 forbids everywhere else, so the
 *   strip's gain rides {@link STRIP_RELEASE_SEC} to silence and the
 *   disconnection happens afterwards. The strip leaves the *map* immediately,
 *   so nothing new can route into a corpse.
 *
 * `AnalyserNode`s hang in *parallel* off each mixer track and off the master
 * (post-limiter, for the clip light) — a tap, never inline, so a meter can
 * never colour the sound.
 */

import { MASTER_MIXER_TRACK_ID, type Channel, type ChannelId, type MixerTrack, type MixerTrackId, type Project } from "@/domain/types";

/** Gain/pan changes ramp rather than jump — click avoidance again (§3.3). */
export const PARAM_RAMP_SEC = 0.02;

/** Limiter settings: low threshold, high ratio (§3.4, lane 3 §5). */
export const LIMITER = {
  thresholdDb: -6,
  kneeDb: 2,
  ratio: 20,
  attackSec: 0.003,
  releaseSec: 0.1,
} as const;

/**
 * How long a removed strip takes to reach silence before it is disconnected.
 *
 * The same order as the voice pool's choke release (`CHOKE_RELEASE_SEC`): long
 * enough to be inaudible, short enough that a delete feels instant.
 */
export const STRIP_RELEASE_SEC = 0.02;

/** A hair past the ramp, so the disconnect can never land on top of it. */
const STRIP_RELEASE_MS = Math.ceil(STRIP_RELEASE_SEC * 1000) + 5;

export const METER_FFT_SIZE = 1024;

export interface ChannelStrip {
  /** Where voices connect. */
  input: GainNode;
  gain: GainNode;
  panner: StereoPannerNode;
  routedTo: MixerTrackId;
}

export interface TrackStrip {
  input: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
}

/** A strip that has left the graph and is riding its release ramp to silence. */
interface RetiringStrip {
  timer: ReturnType<typeof setTimeout>;
  disconnect: () => void;
}

export interface MasterChain {
  input: GainNode;
  panner: StereoPannerNode;
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
}

function rampParam(ctx: BaseAudioContext, param: AudioParam, target: number, rampSec = PARAM_RAMP_SEC): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + rampSec);
}

/** No glide: the value *is* the target from this instant on (see the header). */
function setParamNow(ctx: BaseAudioContext, param: AudioParam, target: number): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(target, now);
}

/** Ramp an existing strip's param; set a brand-new one's outright. */
function applyParam(
  ctx: BaseAudioContext,
  param: AudioParam,
  target: number,
  immediate: boolean,
): void {
  if (immediate) setParamNow(ctx, param, target);
  else rampParam(ctx, param, target);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function createAnalyser(ctx: BaseAudioContext): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = METER_FFT_SIZE;
  analyser.smoothingTimeConstant = 0.5;
  return analyser;
}

function channelGainOf(channel: Channel): number {
  return channel.muted ? 0 : Math.max(0, Math.min(1, channel.volume));
}

function trackGainOf(track: MixerTrack): number {
  return track.muted ? 0 : Math.max(0, Math.min(1, track.volume));
}

/**
 * The live graph for one project. Rebuilt never, updated always: `sync()`
 * adds/removes strips and ramps every gain/pan, so a project edit is a
 * parameter change rather than a graph teardown mid-playback.
 */
export class MixerGraph {
  readonly ctx: BaseAudioContext;
  readonly master: MasterChain;
  readonly #tracks = new Map<MixerTrackId, TrackStrip>();
  readonly #channels = new Map<ChannelId, ChannelStrip>();
  /** Strips ramping to silence, awaiting their disconnect. Flushed by `dispose`. */
  readonly #retiring = new Set<RetiringStrip>();
  /**
   * False until the constructor's first `sync` has run, which is what tells
   * that sync every param it touches is being *initialised*, not changed.
   */
  #initialised = false;

  constructor(ctx: BaseAudioContext, project: Project) {
    this.ctx = ctx;

    const input = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.thresholdDb;
    limiter.knee.value = LIMITER.kneeDb;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attackSec;
    limiter.release.value = LIMITER.releaseSec;
    const analyser = createAnalyser(ctx);

    input.connect(panner);
    panner.connect(limiter);
    limiter.connect(ctx.destination);
    // Post-limiter tap: the clip light must read what actually leaves the bus.
    limiter.connect(analyser);

    this.master = { input, panner, limiter, analyser };
    this.sync(project);
    this.#initialised = true;
  }

  /** Where the metronome click connects — master bus, bypassing the strips. */
  get metronomeDestination(): AudioNode {
    return this.master.input;
  }

  trackStrip(trackId: MixerTrackId): TrackStrip | undefined {
    return this.#tracks.get(trackId);
  }

  channelStrip(channelId: ChannelId): ChannelStrip | undefined {
    return this.#channels.get(channelId);
  }

  /** The `AnalyserNode` tap for a mixer track, or the master (§3.4). */
  meterTap(trackId: MixerTrackId): AnalyserNode | null {
    if (trackId === MASTER_MIXER_TRACK_ID) return this.master.analyser;
    return this.#tracks.get(trackId)?.analyser ?? null;
  }

  /** Where a channel's voices connect, creating its strip if needed. */
  channelInput(channelId: ChannelId): AudioNode | null {
    return this.#channels.get(channelId)?.input ?? null;
  }

  /**
   * Reconcile the graph with a project: add missing strips, drop deleted ones,
   * re-route channels whose `routedToMixerTrackId` changed, and ramp every
   * volume/pan to its current value.
   */
  sync(project: Project): void {
    this.#syncMasterFrom(project);
    this.#syncTracks(project);
    this.#syncChannels(project);
  }

  /** Tear the graph down (engine dispose), flushing any pending retirements. */
  dispose(): void {
    for (const retiring of this.#retiring) clearTimeout(retiring.timer);
    for (const retiring of this.#retiring) retiring.disconnect();
    this.#retiring.clear();
    for (const strip of this.#channels.values()) {
      strip.input.disconnect();
      strip.gain.disconnect();
      strip.panner.disconnect();
    }
    this.#channels.clear();
    for (const strip of this.#tracks.values()) {
      strip.input.disconnect();
      strip.panner.disconnect();
    }
    this.#tracks.clear();
    this.master.input.disconnect();
    this.master.panner.disconnect();
    this.master.limiter.disconnect();
  }

  /**
   * Ramp a removed strip's gain to zero and disconnect it once the ramp has
   * played out — never under a ringing voice (§3.3's no-hard-cut rule).
   *
   * The caller has already dropped the strip from its map, so this is the last
   * reference to it; the timer keeps that reference alive exactly long enough.
   */
  #retire(gain: AudioParam, disconnect: () => void): void {
    rampParam(this.ctx, gain, 0, STRIP_RELEASE_SEC);
    const retiring: RetiringStrip = {
      timer: setTimeout(() => {
        this.#retiring.delete(retiring);
        disconnect();
      }, STRIP_RELEASE_MS),
      disconnect,
    };
    this.#retiring.add(retiring);
  }

  #syncMasterFrom(project: Project): void {
    const master = project.mixerTracks[MASTER_MIXER_TRACK_ID];
    const immediate = !this.#initialised;
    applyParam(
      this.ctx,
      this.master.input.gain,
      master === undefined ? 1 : trackGainOf(master),
      immediate,
    );
    applyParam(
      this.ctx,
      this.master.panner.pan,
      master === undefined ? 0 : clamp(master.pan, -1, 1),
      immediate,
    );
  }

  #syncTracks(project: Project): void {
    for (const trackId of Object.keys(project.mixerTracks)) {
      if (trackId === MASTER_MIXER_TRACK_ID) continue;
      const track = project.mixerTracks[trackId];
      if (track === undefined) continue;
      let strip = this.#tracks.get(trackId);
      // A brand-new strip is initialised, not changed: set, never ramp.
      const isNew = strip === undefined;
      if (strip === undefined) {
        const input = this.ctx.createGain();
        const panner = this.ctx.createStereoPanner();
        const analyser = createAnalyser(this.ctx);
        input.connect(panner);
        panner.connect(this.master.input);
        panner.connect(analyser); // parallel tap
        strip = { input, panner, analyser };
        this.#tracks.set(trackId, strip);
      }
      applyParam(this.ctx, strip.input.gain, trackGainOf(track), isNew);
      applyParam(this.ctx, strip.panner.pan, clamp(track.pan, -1, 1), isNew);
    }

    for (const [trackId, strip] of this.#tracks) {
      if (project.mixerTracks[trackId] !== undefined) continue;
      this.#tracks.delete(trackId);
      this.#retire(strip.input.gain, () => {
        strip.input.disconnect();
        strip.panner.disconnect();
      });
    }
  }

  #syncChannels(project: Project): void {
    for (const channelId of Object.keys(project.channels)) {
      const channel = project.channels[channelId];
      if (channel === undefined) continue;
      let strip = this.#channels.get(channelId);
      const isNew = strip === undefined;
      if (strip === undefined) {
        const gain = this.ctx.createGain();
        const panner = this.ctx.createStereoPanner();
        gain.connect(panner);
        strip = { input: gain, gain, panner, routedTo: channel.routedToMixerTrackId };
        this.#channels.set(channelId, strip);
        this.#route(strip, channel.routedToMixerTrackId);
      } else if (strip.routedTo !== channel.routedToMixerTrackId) {
        strip.panner.disconnect();
        this.#route(strip, channel.routedToMixerTrackId);
      }
      applyParam(this.ctx, strip.gain.gain, channelGainOf(channel), isNew);
      applyParam(this.ctx, strip.panner.pan, clamp(channel.pan, -1, 1), isNew);
    }

    for (const [channelId, strip] of this.#channels) {
      if (project.channels[channelId] !== undefined) continue;
      this.#channels.delete(channelId);
      this.#retire(strip.gain.gain, () => {
        strip.gain.disconnect();
        strip.panner.disconnect();
      });
    }
  }

  /**
   * Connect a channel strip's tail to a mixer track — or straight to the
   * master when the track is Master or has gone missing, so a dangling route
   * silences nothing.
   */
  #route(strip: ChannelStrip, trackId: MixerTrackId): void {
    strip.routedTo = trackId;
    const track = this.#tracks.get(trackId);
    strip.panner.connect(track === undefined ? this.master.input : track.input);
  }
}
