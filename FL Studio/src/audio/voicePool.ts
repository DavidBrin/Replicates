/**
 * Fixed voice pools, oldest-voice stealing, and cross-channel choke groups
 * (SPEC.md §3.3; lane 3 §4).
 *
 * Three rules, all enforced here rather than in the recipes:
 *
 * 1. **Fixed pool per channel (8), FIFO steal.** A ninth simultaneous note on
 *    one channel releases that channel's oldest ringing voice — never the
 *    newest, and never by hard-cutting it.
 * 2. **Choke groups are cross-channel.** Triggering a channel with a
 *    `chokeGroup` releases the ringing voices of *other* channels in the same
 *    group, and never its own — a closed hat chokes a ringing open hat, but a
 *    closed hat does not choke itself (that is the pool's job, rule 1).
 * 3. **Every release is ramped.** Steal and choke both go through
 *    `ActiveVoice.release`, which anchors and ramps before `stop()`.
 *
 * The manager never reads a clock of its own: pruning is driven by the `time`
 * of the trigger being scheduled, so it behaves identically on a live context
 * and on the exporter's `OfflineAudioContext`, whose `currentTime` never
 * advances during rendering.
 */

import type { ChannelId, VoiceKind } from "@/domain/types";

import type { ActiveVoice } from "./types";
import { voiceBuilder } from "./voices";

/** SPEC.md §3.3: "fixed pool per channel (8 voices)". */
export const VOICES_PER_CHANNEL = 8;

/** A stolen voice gets the shortest click-free ramp we can justify. */
export const STEAL_RELEASE_SEC = 0.006;

/** A choke is a musical gesture, so it is allowed to be slightly softer. */
export const CHOKE_RELEASE_SEC = 0.02;

export interface TriggerRequest {
  channelId: ChannelId;
  kind: VoiceKind;
  /** The channel's choke group, if it has one. */
  chokeGroup?: string | undefined;
  destination: AudioNode;
  time: number;
  pitch: number;
  velocity: number;
  durationSec: number;
}

export interface VoiceManagerOptions {
  voicesPerChannel?: number;
  stealReleaseSec?: number;
  chokeReleaseSec?: number;
}

export class VoiceManager {
  readonly #ctx: BaseAudioContext;
  readonly #voicesPerChannel: number;
  readonly #stealReleaseSec: number;
  readonly #chokeReleaseSec: number;
  /** channelId → ringing voices, oldest first (append-only push, shift to steal). */
  readonly #pools = new Map<ChannelId, ActiveVoice[]>();
  /** chokeGroup → the channels currently registered in it. */
  readonly #groups = new Map<string, Set<ChannelId>>();

  constructor(ctx: BaseAudioContext, options: VoiceManagerOptions = {}) {
    this.#ctx = ctx;
    this.#voicesPerChannel = options.voicesPerChannel ?? VOICES_PER_CHANNEL;
    this.#stealReleaseSec = options.stealReleaseSec ?? STEAL_RELEASE_SEC;
    this.#chokeReleaseSec = options.chokeReleaseSec ?? CHOKE_RELEASE_SEC;
  }

  /** Voices still ringing on a channel at the last observed schedule time. */
  activeVoices(channelId: ChannelId): readonly ActiveVoice[] {
    return this.#pools.get(channelId) ?? [];
  }

  activeCount(channelId: ChannelId): number {
    return this.activeVoices(channelId).length;
  }

  /** Total ringing voices across every channel — the pool-leak canary. */
  totalActive(): number {
    let total = 0;
    for (const pool of this.#pools.values()) total += pool.length;
    return total;
  }

  /** Build, register and start one voice, applying choke and steal first. */
  trigger(request: TriggerRequest): ActiveVoice {
    const { channelId, chokeGroup, time } = request;
    this.prune(time);
    this.#registerGroup(channelId, chokeGroup);
    if (chokeGroup !== undefined) this.#choke(channelId, chokeGroup, time);

    const pool = this.#poolFor(channelId);
    while (pool.length >= this.#voicesPerChannel) {
      const oldest = pool.shift();
      oldest?.release(time, this.#stealReleaseSec);
    }

    const voice = voiceBuilder(request.kind)({
      ctx: this.#ctx,
      destination: request.destination,
      time,
      pitch: request.pitch,
      velocity: request.velocity,
      durationSec: request.durationSec,
    });
    pool.push(voice);
    return voice;
  }

  /** Drop voices whose scheduled end has passed `time`. */
  prune(time: number): void {
    for (const [channelId, pool] of this.#pools) {
      const alive = pool.filter((voice) => voice.endTime > time);
      if (alive.length === pool.length) continue;
      if (alive.length === 0) this.#pools.delete(channelId);
      else this.#pools.set(channelId, alive);
    }
  }

  /** Ramp every ringing voice down — Stop, mode change, and teardown. */
  releaseAll(time: number, releaseSec: number = CHOKE_RELEASE_SEC): void {
    for (const pool of this.#pools.values()) {
      for (const voice of pool) voice.release(time, releaseSec);
    }
    this.#pools.clear();
  }

  /**
   * Ramp down every voice ringing on ONE channel, keeping the channel itself
   * (and its choke-group membership) alive.
   *
   * The muting path: a playlist track going muted mid-playback stops the
   * SCHEDULE, but a note already sounding has its whole envelope queued on the
   * audio thread and rings on regardless — see `engine.ts`'s
   * `releaseMutedTrackVoices`. `forgetChannel` is the wrong tool for that: it
   * is for a channel that has been deleted, and it drops the group membership
   * a still-existing channel needs.
   */
  releaseChannel(channelId: ChannelId, time: number, releaseSec: number = CHOKE_RELEASE_SEC): void {
    const pool = this.#pools.get(channelId);
    if (pool === undefined) return;
    for (const voice of pool) voice.release(time, releaseSec);
    this.#pools.delete(channelId);
  }

  /** Forget a channel entirely — it was deleted from the project. */
  forgetChannel(channelId: ChannelId, time: number): void {
    const pool = this.#pools.get(channelId);
    if (pool !== undefined) {
      for (const voice of pool) voice.release(time, this.#chokeReleaseSec);
      this.#pools.delete(channelId);
    }
    for (const [group, members] of this.#groups) {
      members.delete(channelId);
      if (members.size === 0) this.#groups.delete(group);
    }
  }

  #poolFor(channelId: ChannelId): ActiveVoice[] {
    const existing = this.#pools.get(channelId);
    if (existing !== undefined) return existing;
    const created: ActiveVoice[] = [];
    this.#pools.set(channelId, created);
    return created;
  }

  #registerGroup(channelId: ChannelId, chokeGroup: string | undefined): void {
    // A channel's group can change under it (the rack lets you retype it), so
    // stale memberships are dropped rather than accumulated.
    for (const [group, members] of this.#groups) {
      if (group !== chokeGroup) members.delete(channelId);
    }
    if (chokeGroup === undefined) return;
    const members = this.#groups.get(chokeGroup) ?? new Set<ChannelId>();
    members.add(channelId);
    this.#groups.set(chokeGroup, members);
  }

  #choke(triggeringChannelId: ChannelId, chokeGroup: string, time: number): void {
    const members = this.#groups.get(chokeGroup);
    if (members === undefined) return;
    for (const memberId of members) {
      if (memberId === triggeringChannelId) continue; // never chokes itself
      const pool = this.#pools.get(memberId);
      if (pool === undefined) continue;
      for (const voice of pool) voice.release(time, this.#chokeReleaseSec);
      this.#pools.delete(memberId);
    }
  }
}
