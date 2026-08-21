/**
 * The signal chain and the meter taps (SPEC.md §3.4), built exactly as specced:
 *
 * ```
 * voice → channel GainNode (Channel.volume) → StereoPannerNode (Channel.pan)
 *       → mixer-track GainNode + StereoPannerNode (MixerTrack.volume/pan)
 *       → master GainNode → DynamicsCompressorNode (limiter) → destination
 * ```
 *
 * Two things the diagram does not say, both decided here:
 *
 * - **Velocity is not in the channel gain.** §3.4 writes the channel gain as
 *   `Channel.volume·velocity`, but velocity is per-*note* and the channel gain
 *   is per-*channel* and shared by every ringing voice — folding velocity into
 *   it would retune notes already sounding. Velocity scales the voice's own
 *   envelope peak (`voices/shared.ts`), which is the same product at the same
 *   point in the chain, per note.
 * - **Mutes are ramped gains of 0**, never disconnections (§3.2's note on why
 *   muted channels still compile: un-muting mid-bar has to be instant).
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

export interface MasterChain {
  input: GainNode;
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
}

function rampParam(ctx: BaseAudioContext, param: AudioParam, target: number, rampSec = PARAM_RAMP_SEC): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + rampSec);
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

  constructor(ctx: BaseAudioContext, project: Project) {
    this.ctx = ctx;

    const input = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.thresholdDb;
    limiter.knee.value = LIMITER.kneeDb;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attackSec;
    limiter.release.value = LIMITER.releaseSec;
    const analyser = createAnalyser(ctx);

    input.connect(limiter);
    limiter.connect(ctx.destination);
    // Post-limiter tap: the clip light must read what actually leaves the bus.
    limiter.connect(analyser);

    this.master = { input, limiter, analyser };
    this.sync(project);
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

  /** Ramp everything to silence and tear the graph down (engine dispose). */
  dispose(): void {
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
    this.master.limiter.disconnect();
  }

  #syncMasterFrom(project: Project): void {
    const master = project.mixerTracks[MASTER_MIXER_TRACK_ID];
    rampParam(this.ctx, this.master.input.gain, master === undefined ? 1 : trackGainOf(master));
  }

  #syncTracks(project: Project): void {
    for (const trackId of Object.keys(project.mixerTracks)) {
      if (trackId === MASTER_MIXER_TRACK_ID) continue;
      const track = project.mixerTracks[trackId];
      if (track === undefined) continue;
      let strip = this.#tracks.get(trackId);
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
      rampParam(this.ctx, strip.input.gain, trackGainOf(track));
      rampParam(this.ctx, strip.panner.pan, Math.max(-1, Math.min(1, track.pan)));
    }

    for (const [trackId, strip] of this.#tracks) {
      if (project.mixerTracks[trackId] !== undefined) continue;
      strip.input.disconnect();
      strip.panner.disconnect();
      this.#tracks.delete(trackId);
    }
  }

  #syncChannels(project: Project): void {
    for (const channelId of Object.keys(project.channels)) {
      const channel = project.channels[channelId];
      if (channel === undefined) continue;
      let strip = this.#channels.get(channelId);
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
      rampParam(this.ctx, strip.gain.gain, channelGainOf(channel));
      rampParam(this.ctx, strip.panner.pan, Math.max(-1, Math.min(1, channel.pan)));
    }

    for (const [channelId, strip] of this.#channels) {
      if (project.channels[channelId] !== undefined) continue;
      strip.gain.disconnect();
      strip.panner.disconnect();
      this.#channels.delete(channelId);
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
