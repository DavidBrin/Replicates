/**
 * The audio engine: `StepEvents` in, sound out.
 *
 * ## Events, never state
 *
 * This is the constraint that shapes the whole file, and it comes from the
 * netcode rather than from anything about audio. A rollback re-simulates up to
 * eight frames in a single tick (see `net/rollback.ts`), so anything derived by
 * *looking at the state each frame* would fire eight times for one punch. The
 * simulation therefore reports what happened as a list of events, `step()`
 * returns that list, and the rollback session hands over only the newest
 * frame's — replayed frames report nothing. This engine consumes that list and
 * nothing else.
 *
 * The one sound that cannot work that way is the shield hum, because it is not
 * an event at all: it starts when a button goes down and ends when it comes up,
 * and there is no "shield frame" event to count. It gets an explicitly
 * *level-triggered* API — `setShieldHeld(port, held)` — called every rendered
 * frame from the final state. Level-triggering is what makes it rollback-safe:
 * calling it eight times with the same value does nothing seven times.
 *
 * ## The autoplay policy
 *
 * Browsers create an `AudioContext` in the `suspended` state and refuse to
 * start it until the user has interacted with the page. That is not an error to
 * handle once — it is a state the engine can be in at any time, including after
 * the browser suspends a backgrounded tab. So every entry point is a no-op
 * while suspended rather than an exception, and `unlockOnGesture` wires the
 * one-shot listeners that start it.
 *
 * ## Why sounds are deduplicated per frame
 *
 * Two identical synthesised sounds triggered on the same frame are not two
 * sounds. They are the same waveform summed with itself — one sound, six
 * decibels louder, and twice the node graph. So a frame plays at most one of
 * each kind, choosing the loudest candidate where there is one. A four-player
 * free-for-all where everybody connects at once should get louder, not muddier.
 */

import { fx } from "@/engine/fixed";
import type { StepEvents } from "@/engine/types";
import type { SynthContext, Voice } from "./synth";
import {
  clank,
  countdownBeep,
  dodge,
  finalSmash,
  goStinger,
  grab,
  heavyHit,
  jump,
  koBlast,
  land,
  lightHit,
  menuBack,
  menuConfirm,
  menuMove,
  perfectShield,
  shieldBreak,
  shieldHit,
  shieldVoice,
  smashBallBreak,
  throwRelease,
} from "./sfx";

export * from "./synth";
export * as sfx from "./sfx";

export type UiSound = "move" | "confirm" | "back";

export interface HitThresholds {
  /**
   * Above this knockback, a hit uses the heavy recipe. Fixed-point, like every
   * quantity in `StepEvents` (see `engine/types.ts`): the value is the real
   * number times 4096.
   */
  readonly knockback: number;
  /** …or above this damage, in the same units. */
  readonly damage: number;
}

/** 80 units of knockback, or 10%. Either one is a hit that mattered. */
export const DEFAULT_HIT_THRESHOLDS: HitThresholds = {
  knockback: fx(80),
  damage: fx(10),
};

export interface AudioEngineOptions {
  /** Injected in tests, and deferred so nothing is constructed during SSR. */
  contextFactory?: () => AudioContext;
  masterVolume?: number;
  sfxVolume?: number;
  muted?: boolean;
  hitThresholds?: Partial<HitThresholds>;
}

export class AudioEngine {
  private readonly contextFactory: () => AudioContext;
  private readonly thresholds: HitThresholds;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private synth: SynthContext | null = null;

  private masterVolume: number;
  private sfxVolume: number;
  private isMuted: boolean;
  private disposed = false;

  private readonly shields = new Map<number, Voice>();

  constructor(options: AudioEngineOptions = {}) {
    this.contextFactory =
      options.contextFactory ??
      (() => {
        const Ctor =
          globalThis.AudioContext ??
          (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) throw new Error("Web Audio is unavailable in this environment");
        return new Ctor();
      });
    this.masterVolume = options.masterVolume ?? 0.8;
    this.sfxVolume = options.sfxVolume ?? 1;
    this.isMuted = options.muted ?? false;
    this.thresholds = { ...DEFAULT_HIT_THRESHOLDS, ...options.hitThresholds };
  }

  /* ------------------------------------------------------------- lifecycle -- */

  /** True when sound will actually come out. */
  get running(): boolean {
    return !this.disposed && this.ctx !== null && this.ctx.state === "running";
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Start, or restart, the audio context.
   *
   * Must be called from inside a user gesture the first time. Safe to call
   * repeatedly: a browser that suspends a backgrounded tab needs exactly this
   * again when the tab comes back, and there is no reliable event for that.
   */
  async resume(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) this.build();
    if (!this.ctx) return;
    if (this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        // Called outside a gesture. Not an error — the next gesture will do it.
      }
    }
  }

  /**
   * Start on the first interaction of any kind, then get out of the way.
   *
   * Returns a function that removes the listeners early, for a component that
   * unmounts before anybody touches anything.
   */
  unlockOnGesture(target: EventTarget = globalThis as unknown as EventTarget): () => void {
    if (typeof target.addEventListener !== "function") return () => {};
    const kinds = ["pointerdown", "keydown", "touchstart"] as const;
    const handler = () => {
      void this.resume();
      remove();
    };
    const remove = () => {
      for (const kind of kinds) target.removeEventListener(kind, handler);
    };
    for (const kind of kinds) target.addEventListener(kind, handler, { once: true });
    return remove;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.shields.values()) voice.stop();
    this.shields.clear();
    this.master?.disconnect();
    this.sfxBus?.disconnect();
    void this.ctx?.close().catch(() => {
      /* closing a context that is already closed is not interesting */
    });
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.synth = null;
  }

  /* ---------------------------------------------------------------- mixing -- */

  get muted(): boolean {
    return this.isMuted;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.applyGains();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  get volume(): { master: number; sfx: number } {
    return { master: this.masterVolume, sfx: this.sfxVolume };
  }

  setMasterVolume(value: number): void {
    this.masterVolume = clamp01(value);
    this.applyGains();
  }

  setSfxVolume(value: number): void {
    this.sfxVolume = clamp01(value);
    this.applyGains();
  }

  /* ----------------------------------------------------------------- sound -- */

  /**
   * Play one frame of the match.
   *
   * Hand it `AdvanceResult.events` and nothing else. Frames replayed by a
   * rollback carry no events, which is what stops eight explosions.
   */
  handleEvents(events: StepEvents): void {
    const sc = this.ready();
    if (!sc) return;

    // Order matters where two sounds would otherwise collide: a KO and the hit
    // that caused it land on the same frame, and the KO should be the one that
    // arrives at full volume.
    if (events.kos.length > 0) koBlast(sc);

    if (events.shieldBreaks.length > 0) shieldBreak(sc);

    if (events.smashBallBroken !== null) smashBallBreak(sc);

    if (events.finalSmashes.length > 0) finalSmash(sc);

    if (events.hits.length > 0) {
      // One hit sound per frame, chosen by the hit that moved somebody most.
      // Summing four copies of one waveform makes it louder, not busier.
      let loudest = events.hits[0];
      for (const hit of events.hits) if (hit.knockback > loudest.knockback) loudest = hit;
      if (this.isHeavy(loudest)) heavyHit(sc);
      else lightHit(sc);
    }

    if (events.shieldHits.length > 0) shieldHit(sc);
    if (events.clanks.length > 0) clank(sc);
    if (events.jumps.length > 0) jump(sc);
    if (events.lands.length > 0) land(sc);
  }

  /**
   * The shield hum, level-triggered.
   *
   * Call it every rendered frame with the final state's shield status. Calling
   * it repeatedly with the same value does nothing, which is exactly why it is
   * safe under rollback where an edge-triggered API would not be.
   */
  setShieldHeld(port: number, held: boolean): void {
    const sc = this.ready();
    if (!sc) {
      // Still forget the voice, so a context that comes back does not think a
      // shield from before the pause is still up.
      if (!held) this.shields.delete(port);
      return;
    }
    const existing = this.shields.get(port);
    if (held && !existing) {
      this.shields.set(port, shieldVoice(sc));
    } else if (!held && existing) {
      existing.stop();
      this.shields.delete(port);
    }
  }

  /** A parry landed. Edge-triggered, and reported by the caller. */
  playPerfectShield(): void {
    const sc = this.ready();
    if (sc) perfectShield(sc);
  }

  playDodge(): void {
    const sc = this.ready();
    if (sc) dodge(sc);
  }

  playGrab(): void {
    const sc = this.ready();
    if (sc) grab(sc);
  }

  playThrow(): void {
    const sc = this.ready();
    if (sc) throwRelease(sc);
  }

  playCountdown(): void {
    const sc = this.ready();
    if (sc) countdownBeep(sc);
  }

  playGo(): void {
    const sc = this.ready();
    if (sc) goStinger(sc);
  }

  /** Menus. The only sounds that exist outside a match. */
  playUi(sound: UiSound): void {
    const sc = this.ready();
    if (!sc) return;
    if (sound === "move") menuMove(sc);
    else if (sound === "confirm") menuConfirm(sc);
    else menuBack(sc);
  }

  /* ------------------------------------------------------------- internals -- */

  private isHeavy(hit: StepEvents["hits"][number]): boolean {
    return hit.knockback >= this.thresholds.knockback || hit.damage >= this.thresholds.damage;
  }

  private ready(): SynthContext | null {
    return this.running ? this.synth : null;
  }

  private build(): void {
    let ctx: AudioContext;
    try {
      ctx = this.contextFactory();
    } catch {
      // No Web Audio: an old browser, or a locked-down embedding. The game is
      // entirely playable in silence, so this is not fatal.
      return;
    }
    const master = ctx.createGain();
    const sfxBus = ctx.createGain();
    sfxBus.connect(master);
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.sfxBus = sfxBus;
    this.synth = { ctx, destination: sfxBus };
    this.applyGains();
  }

  private applyGains(): void {
    if (!this.ctx || !this.master || !this.sfxBus) return;
    const now = this.ctx.currentTime;
    // A short ramp rather than a jump: setting a gain instantaneously produces
    // a discontinuity in the waveform, which is a click.
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.isMuted ? 0 : this.masterVolume, now + 0.02);
    this.sfxBus.gain.cancelScheduledValues(now);
    this.sfxBus.gain.setValueAtTime(this.sfxBus.gain.value, now);
    this.sfxBus.gain.linearRampToValueAtTime(this.sfxVolume, now + 0.02);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
