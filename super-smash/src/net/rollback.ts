/**
 * The rollback session — GGPO's idea, implemented against this game's simulation.
 *
 * The whole technique rests on one property the engine guarantees (SPEC §3):
 * `step()` is pure and deterministic, so a state plus a list of inputs always
 * produces the same next state, on any machine, at any time. Given that, a peer
 * never has to *wait* for the opponent's input — it guesses, keeps drawing, and
 * when the truth arrives it rewinds to the last known-good state and replays
 * the frames in between. The player sees the correction, not the delay.
 *
 * The simulation is injected rather than imported, for two reasons. The obvious
 * one is testability: the tests below run this session against a fake `step`
 * that adds numbers, so a rollback bug shows up as a wrong number rather than
 * as a fighter mysteriously standing in the wrong place. The subtler one is the
 * layering rule — `net/` sits above `engine/` and must not reach into it, and
 * an injected dependency makes that structural instead of aspirational.
 *
 * ## The five mechanisms, and why each exists
 *
 * **Input delay (2 frames).** Your own input is scheduled two frames in the
 * future, which buys 33ms for the opponent's input to arrive before it is
 * needed. On a good connection that is enough that no rollback happens at all,
 * and a rollback that never happens is the cheapest possible one. Crucially,
 * because every input is keyed by *absolute frame number*, the delay is a
 * purely local decision — two peers running different delays still simulate
 * identical states. Only the peer with the larger delay feels it.
 *
 * **Prediction, capped at 8 frames.** The guess is "they are still holding what
 * they were holding", which is right most of the time because inputs are held
 * across several frames. Past 8 frames the guess is worthless and the
 * correction would be violent, so the session stalls instead. The cap is also
 * what makes the state ring sufficient: nothing can ever ask to roll back
 * further than the ring holds.
 *
 * **A 10-slot state ring.** `MAX_PREDICTION_FRAMES + 2`, and *sized from the
 * cap* rather than fixed alongside it — raising the cap raises the ring. Every
 * frame is saved before it is simulated, so any frame inside the prediction
 * window can be restored exactly, whatever the window was configured to be.
 *
 * **Time sync.** Two machines never run at exactly 60Hz. Left alone, the faster
 * one drifts ahead until it is permanently predicting eight frames and
 * permanently rolling back. Each input packet carries the sender's frame; the
 * peer that finds itself ahead gives back a frame occasionally, and the pair
 * stays level.
 *
 * **A spike hatch.** Past a threshold a correction is worse than a freeze — a
 * 20-frame resimulation teleports everybody and reads as a bug, while a brief
 * honest pause reads as the network hiccup it is.
 */

import type { GameState, InputFrame, StepEvents } from "@/engine/types";
import { emptyEvents } from "@/engine/types";
import type { Transport, Unsubscribe } from "./transport";
import {
  INPUT_WINDOW_FRAMES,
  PacketType,
  decodePacket,
  encodePacket,
  type InputPacket,
  type Packet,
} from "./packet";

/* --------------------------------------------------------------- constants -- */

/** How far ahead of confirmed input the simulation may run. SPEC §5. */
export const MAX_PREDICTION_FRAMES = 8;

/** Frames of input history kept per port. A power of two so `%` is a mask. */
export const INPUT_HISTORY_FRAMES = 256;

/**
 * How many save slots a given prediction cap needs.
 *
 * Two more than the cap, so the frame being simulated and the frame after it
 * never evict a restorable one. This is a *function* rather than a constant
 * because the cap is configurable and the ring is not allowed to be smaller
 * than it: a late input targeting an evicted snapshot cannot be rolled back to,
 * and the session's only remaining option is to carry on from state it knows is
 * wrong. Sizing the ring from the cap makes that unreachable by construction
 * rather than by everybody remembering to leave the default alone.
 */
export function savedStateSlotsFor(maxPredictionFrames: number): number {
  return maxPredictionFrames + 2;
}

/** Save slots at the default prediction cap. */
export const SAVED_STATE_SLOTS = savedStateSlotsFor(MAX_PREDICTION_FRAMES);

/**
 * The largest prediction cap the input history can serve.
 *
 * A rollback re-gathers the inputs for every frame it replays, and those come
 * out of a 256-frame ring; predicting further than the ring is long would mean
 * replaying frames whose inputs have already been overwritten. The two-frame
 * margin matches the ring's own.
 */
export const MAX_PREDICTION_FRAMES_LIMIT = INPUT_HISTORY_FRAMES - 2;

export const DEFAULT_INPUT_DELAY = 2;
export const MIN_INPUT_DELAY = 1;
export const MAX_INPUT_DELAY = 8;

/** Desync checks and pings both ride this cadence: twice a second. */
export const HASH_INTERVAL_FRAMES = 30;
export const PING_INTERVAL_FRAMES = 30;

/** Frames of lead over the peer that trigger giving a frame back. */
export const TIME_SYNC_THRESHOLD_FRAMES = 2;
/** …and the minimum gap between two such concessions, so we drift back gently. */
export const TIME_SYNC_COOLDOWN_FRAMES = 6;

/** A rollback at least this deep is a spike: freeze instead of warping. */
export const SPIKE_ROLLBACK_FRAMES = 6;
/** How long that freeze lasts. ~66ms — long enough to be a pause, short enough
 *  not to be a disconnection. */
export const SPIKE_PAUSE_FRAMES = 4;

const FRAME_MS = 1000 / 60;

/* ---------------------------------------------------------------- contract -- */

/**
 * The simulation, as the session sees it.
 *
 * Generic over the state so the tests can drive it with a two-field object;
 * defaulted to `GameState` so real callers get the exact contract from SPEC §3
 * with no type arguments.
 */
export interface RollbackDeps<S = GameState> {
  /**
   * One frame of simulation.
   *
   * `prevInputs` is not optional and is not a convenience. A button in this
   * game is an *edge*: `pressed(input, prev, b)` is "held now and not before",
   * and `GameState` deliberately carries no record of the previous frame's
   * keys (types.ts). Hand the same array for both and every press reads as a
   * hold — `input & b && !(prev & b)` with `prev === input` is false for every
   * button, every frame — so nothing in a netplay match can attack, jump,
   * shield, grab or special. Fighters walk, and nothing else.
   *
   * The session supplies it from the input history, which means it rolls back
   * with everything else. Keeping "last frame's inputs" in a field outside the
   * snapshot would reintroduce the same bug in a subtler shape: a rewind would
   * resume against whichever frame happened to run last rather than against the
   * frame that actually precedes the one being replayed.
   */
  step(state: S, inputs: InputFrame[], prevInputs: InputFrame[]): { state: S; events: StepEvents };
  cloneState(state: S): S;
  hashState(state: S): number;
}

export type StallReason = "prediction" | "timesync" | "spike";

export interface AdvanceResult<S = GameState> {
  /** The state to render. Always the newest one, never an intermediate. */
  readonly state: S;
  /**
   * What happened on the frame just simulated — and *only* that frame.
   *
   * Frames replayed during a rollback report nothing, which is the entire
   * reason the audio and particle layers are event-driven: re-simulating eight
   * frames must not replay eight explosions (SPEC §3).
   */
  readonly events: StepEvents;
  /** The frame count *after* this call. Unchanged when the session stalled. */
  readonly frame: number;
  readonly advanced: boolean;
  readonly stallReason: StallReason | null;
  /** Frames re-simulated before this frame ran. 0 on a clean frame. */
  readonly rolledBackFrames: number;
}

export interface DesyncReport {
  readonly frame: number;
  readonly localHash: number;
  readonly remoteHash: number;
  readonly peerId: string;
  readonly port: number;
}

export interface NetStats {
  readonly frame: number;
  /** Highest frame whose inputs are known for every port. */
  readonly confirmedFrame: number;
  /** How far the local simulation has run past confirmed input. */
  readonly predictionDepth: number;
  readonly maxPredictionDepth: number;
  readonly rollbacks: number;
  readonly rolledBackFrames: number;
  readonly maxRollbackFrames: number;
  readonly stalls: { prediction: number; timesync: number; spike: number };
  readonly rttMs: number;
  readonly inputDelay: number;
  readonly peers: number;
  readonly packetsSent: number;
  readonly packetsReceived: number;
  readonly packetsRejected: number;
  /** A peer sent two different inputs for one frame. Should always be zero. */
  readonly inputConflicts: number;
  /** Input that arrived too late to roll back to. Should always be zero. */
  readonly lateInputs: number;
  readonly desyncs: number;
  readonly hashesCompared: number;
}

export interface RollbackConfig<S = GameState> {
  transport: Transport;
  deps: RollbackDeps<S>;
  initialState: S;
  /** Ports 0..playerCount-1 are simulated. */
  playerCount: number;
  /**
   * Ports whose input this machine supplies.
   *
   * CPU-controlled ports belong here on exactly one peer, which then sends
   * their inputs over the wire like any other port. Running the AI on both
   * machines and trusting it to agree would be a second determinism contract to
   * maintain; sending 2 bytes a frame is free by comparison.
   */
  localPorts: readonly number[];
  inputDelay?: number;
  /** Retune the delay from measured RTT. Safe mid-match: see the header note. */
  autoInputDelay?: boolean;
  maxPredictionFrames?: number;
  spikeRollbackFrames?: number;
  spikePauseFrames?: number;
  hashIntervalFrames?: number;
  pingIntervalFrames?: number;
  /**
   * Clock for RTT measurement only.
   *
   * Never reaches the simulation — SPEC §3 forbids wall-clock time inside
   * `step()`, and this session honours that by keeping every time-derived
   * quantity (RTT, the delay recommendation) strictly outside the state it
   * feeds in.
   */
  now?: () => number;
  onDesync?: (report: DesyncReport) => void;
  onSpike?: (info: { frame: number; rollbackFrames: number }) => void;
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
}

/* ------------------------------------------------------------ input queues -- */

const NEUTRAL_INPUT: InputFrame = 0;

/**
 * One port's input history, as three parallel rings.
 *
 * `frameOf` is what makes a ring safe without clearing it: a slot belongs to
 * frame `f` only if it says so, so a stale slot from 256 frames ago reads as
 * "unknown" rather than as a plausible input.
 */
class PortInputs {
  private readonly value = new Int32Array(INPUT_HISTORY_FRAMES);
  private readonly frameOf = new Int32Array(INPUT_HISTORY_FRAMES).fill(-1);
  /** What the simulation actually used at each frame, and whether it guessed. */
  private readonly used = new Int32Array(INPUT_HISTORY_FRAMES);
  private readonly usedFrameOf = new Int32Array(INPUT_HISTORY_FRAMES).fill(-1);

  /** Highest frame with a real input, and its value: the prediction source. */
  lastKnownFrame = -1;
  lastKnownValue: InputFrame = NEUTRAL_INPUT;
  /** Highest frame such that every frame up to it is known. */
  confirmedThrough = -1;

  has(frame: number): boolean {
    return frame >= 0 && this.frameOf[frame % INPUT_HISTORY_FRAMES] === frame;
  }

  get(frame: number): InputFrame | null {
    return this.has(frame) ? this.value[frame % INPUT_HISTORY_FRAMES] : null;
  }

  /**
   * Record a real input. Returns "already had a different value here", which is
   * a peer bug rather than a network one — the redundant window resends the
   * same frame many times, and every copy must agree.
   */
  set(frame: number, input: InputFrame): "new" | "duplicate" | "conflict" {
    if (frame < 0) return "duplicate";
    const slot = frame % INPUT_HISTORY_FRAMES;
    if (this.frameOf[slot] === frame) {
      return this.value[slot] === input ? "duplicate" : "conflict";
    }
    this.frameOf[slot] = frame;
    this.value[slot] = input;
    if (frame > this.lastKnownFrame) {
      this.lastKnownFrame = frame;
      this.lastKnownValue = input;
    }
    while (this.has(this.confirmedThrough + 1)) this.confirmedThrough++;
    return "new";
  }

  /**
   * The guess: whatever they were last holding.
   *
   * Right far more often than it is wrong, because a human holds a direction
   * for a dozen frames and taps a button for four. Searching backwards first
   * covers the case where a hole in the middle of the window has not healed
   * yet — the frame before the hole is a better guess than the newest frame.
   */
  predict(frame: number): InputFrame {
    for (let f = frame; f > frame - INPUT_WINDOW_FRAMES && f >= 0; f--) {
      if (this.has(f)) return this.value[f % INPUT_HISTORY_FRAMES];
    }
    return this.lastKnownFrame >= 0 ? this.lastKnownValue : NEUTRAL_INPUT;
  }

  markUsed(frame: number, input: InputFrame): void {
    const slot = frame % INPUT_HISTORY_FRAMES;
    this.usedFrameOf[slot] = frame;
    this.used[slot] = input;
  }

  usedAt(frame: number): InputFrame | null {
    const slot = frame % INPUT_HISTORY_FRAMES;
    return this.usedFrameOf[slot] === frame ? this.used[slot] : null;
  }
}

interface SavedState<S> {
  frame: number;
  state: S | null;
}

interface PeerInfo {
  readonly id: string;
  /** Ports we have actually heard input from, for diagnostics. */
  readonly ports: Set<number>;
  lastPacketFrame: number;
}

/* ----------------------------------------------------------------- session -- */

export class RollbackSession<S = GameState> {
  private readonly transport: Transport;
  private readonly deps: RollbackDeps<S>;
  private readonly playerCount: number;
  private readonly localPorts: readonly number[];
  private readonly remotePorts: readonly number[];
  private readonly maxPrediction: number;
  private readonly savedSlots: number;
  private readonly spikeRollbackFrames: number;
  private readonly spikePauseFrames: number;
  private readonly hashInterval: number;
  private readonly pingInterval: number;
  private readonly autoInputDelay: boolean;
  private readonly now: () => number;
  private readonly onDesync?: (report: DesyncReport) => void;
  private readonly onSpike?: (info: { frame: number; rollbackFrames: number }) => void;
  private readonly onPeerJoinCb?: (peerId: string) => void;
  private readonly onPeerLeaveCb?: (peerId: string) => void;

  private readonly inputs: PortInputs[] = [];
  private readonly saved: SavedState<S>[] = [];
  private readonly peers = new Map<string, PeerInfo>();
  private readonly unsubscribes: Unsubscribe[] = [];

  /** Local hashes awaiting a peer's, and peer hashes awaiting ours. */
  private readonly localHashes = new Map<number, number>();
  private readonly remoteHashes = new Map<number, { hash: number; peerId: string; port: number }>();

  private readonly pings = new Map<number, number>();
  private pingToken = 1;

  private state: S;
  private currentFrame = 0;
  private inputDelay: number;
  /** Highest absolute frame a local input has been scheduled for. */
  private highestScheduled: number;
  private pendingRollbackFrame: number | null = null;
  /** The correction a spike pause has already been spent on. Without this the
   *  pause re-triggers on the same rollback forever, because freezing is
   *  precisely what stops the distance from changing. */
  private spikeDeferredFrame: number | null = null;
  private pauseFrames = 0;
  private lastTimeSyncStall = -TIME_SYNC_COOLDOWN_FRAMES;
  private lastDelayChangeFrame = -Infinity;
  private lastPingFrame = -Infinity;
  private rttMs = 0;
  private rttSamples = 0;
  private frameAdvantage = 0;
  private closed = false;

  private readonly counters = {
    rollbacks: 0,
    rolledBackFrames: 0,
    maxRollbackFrames: 0,
    maxPredictionDepth: 0,
    stallPrediction: 0,
    stallTimesync: 0,
    stallSpike: 0,
    packetsSent: 0,
    packetsReceived: 0,
    packetsRejected: 0,
    inputConflicts: 0,
    lateInputs: 0,
    desyncs: 0,
    hashesCompared: 0,
  };

  constructor(config: RollbackConfig<S>) {
    this.transport = config.transport;
    this.deps = config.deps;
    this.playerCount = config.playerCount;
    this.localPorts = [...config.localPorts];
    this.remotePorts = Array.from({ length: config.playerCount }, (_, i) => i).filter(
      (p) => !this.localPorts.includes(p),
    );
    // The cap is clamped to what the input history can serve, and the ring is
    // then sized *from* the cap — never the other way round. A cap larger than
    // the ring is the one configuration that corrupts state silently: input
    // arriving for an evicted frame is uncorrectable, and the session's only
    // remaining move is to keep playing from state it knows is wrong.
    this.maxPrediction = clampInt(
      config.maxPredictionFrames ?? MAX_PREDICTION_FRAMES,
      1,
      MAX_PREDICTION_FRAMES_LIMIT,
    );
    this.savedSlots = savedStateSlotsFor(this.maxPrediction);
    this.spikeRollbackFrames = config.spikeRollbackFrames ?? SPIKE_ROLLBACK_FRAMES;
    this.spikePauseFrames = config.spikePauseFrames ?? SPIKE_PAUSE_FRAMES;
    this.hashInterval = config.hashIntervalFrames ?? HASH_INTERVAL_FRAMES;
    this.pingInterval = config.pingIntervalFrames ?? PING_INTERVAL_FRAMES;
    this.autoInputDelay = config.autoInputDelay ?? true;
    this.now = config.now ?? defaultClock;
    this.onDesync = config.onDesync;
    this.onSpike = config.onSpike;
    this.onPeerJoinCb = config.onPeerJoin;
    this.onPeerLeaveCb = config.onPeerLeave;

    this.state = config.initialState;
    this.inputDelay = clampInt(
      config.inputDelay ?? DEFAULT_INPUT_DELAY,
      MIN_INPUT_DELAY,
      MAX_INPUT_DELAY,
    );

    for (let p = 0; p < this.playerCount; p++) this.inputs.push(new PortInputs());

    // Preallocated ring. Slots are records rather than raw states so a save is
    // one field write plus whatever `cloneState` costs — see the note on
    // `saveState` about the one allocation this contract cannot avoid.
    for (let i = 0; i < this.savedSlots; i++) this.saved.push({ frame: -1, state: null });

    // The first `inputDelay` frames have no input behind them: nothing has been
    // read yet, so they are neutral by construction.
    for (const port of this.localPorts) {
      for (let f = 0; f < this.inputDelay; f++) this.inputs[port].set(f, NEUTRAL_INPUT);
    }
    this.highestScheduled = this.inputDelay - 1;

    // The same reasoning applies to the *remote* ports, but only as far as the
    // smallest delay anybody may run: every peer schedules its first read input
    // at its own `inputDelay`, and that is at least `MIN_INPUT_DELAY`, so frame
    // 0 is neutral on every machine whatever delay each chose. Knowing that
    // outright is worth the four lines — without it, frame 0 is simulated
    // against a guess, and a session over a perfect link would still record a
    // prediction it never needed to make.
    for (const port of this.remotePorts) {
      for (let f = 0; f < MIN_INPUT_DELAY; f++) this.inputs[port].set(f, NEUTRAL_INPUT);
    }

    this.unsubscribes.push(
      this.transport.onMessage((bytes, peerId) => this.receive(bytes, peerId)),
      this.transport.onPeerJoin((peerId) => {
        this.peers.set(peerId, { id: peerId, ports: new Set(), lastPacketFrame: -1 });
        this.onPeerJoinCb?.(peerId);
      }),
      this.transport.onPeerLeave((peerId) => {
        this.peers.delete(peerId);
        this.onPeerLeaveCb?.(peerId);
      }),
    );
  }

  /* ------------------------------------------------------------- accessors -- */

  /** The current state. Never mutate it; `step()` owns state transitions. */
  get currentState(): S {
    return this.state;
  }

  get frame(): number {
    return this.currentFrame;
  }

  get delay(): number {
    return this.inputDelay;
  }

  /** Highest frame whose inputs are known for every port. -1 before any. */
  get confirmedFrame(): number {
    if (this.remotePorts.length === 0) return this.highestScheduled;
    let min = Infinity;
    for (const port of this.remotePorts) min = Math.min(min, this.inputs[port].confirmedThrough);
    for (const port of this.localPorts) min = Math.min(min, this.inputs[port].confirmedThrough);
    return min === Infinity ? -1 : min;
  }

  /** How far the simulation has run past confirmed input, in frames. */
  get predictionDepth(): number {
    if (this.remotePorts.length === 0) return 0;
    return Math.max(0, this.currentFrame - 1 - this.remoteConfirmedFrame());
  }

  stats(): NetStats {
    const c = this.counters;
    return {
      frame: this.currentFrame,
      confirmedFrame: this.confirmedFrame,
      predictionDepth: this.predictionDepth,
      maxPredictionDepth: c.maxPredictionDepth,
      rollbacks: c.rollbacks,
      rolledBackFrames: c.rolledBackFrames,
      maxRollbackFrames: c.maxRollbackFrames,
      stalls: {
        prediction: c.stallPrediction,
        timesync: c.stallTimesync,
        spike: c.stallSpike,
      },
      rttMs: this.rttMs,
      inputDelay: this.inputDelay,
      peers: this.peers.size,
      packetsSent: c.packetsSent,
      packetsReceived: c.packetsReceived,
      packetsRejected: c.packetsRejected,
      inputConflicts: c.inputConflicts,
      lateInputs: c.lateInputs,
      desyncs: c.desyncs,
      hashesCompared: c.hashesCompared,
    };
  }

  /* --------------------------------------------------------------- the loop -- */

  /**
   * Run one frame, or decline to.
   *
   * `localInputs` is indexed by port; entries for remote ports are ignored, so
   * the caller can hand over the same array it built for the renderer. A single
   * local port may pass a bare number.
   */
  advance(localInputs: InputFrame | readonly InputFrame[]): AdvanceResult<S> {
    if (this.closed) return this.stalled("spike", 0);

    // A spike freeze already in progress. Packets keep flowing — the whole
    // point of the pause is to let the missing input arrive, so that the
    // correction that follows is one clean jump rather than three.
    if (this.pauseFrames > 0) {
      this.pauseFrames--;
      this.counters.stallSpike++;
      this.heartbeat();
      return this.stalled("spike", 0);
    }

    let rolledBack = 0;
    if (this.pendingRollbackFrame !== null) {
      const distance = this.currentFrame - this.pendingRollbackFrame;
      // Deep correction, and one we have not already paused for. Freeze first:
      // the simulation does not advance during the pause, so the correction
      // cannot grow, more of the missing input arrives, and a still picture
      // that resumes correctly beats a picture that warps. The second half of
      // that condition is what stops it from being a freeze forever — a
      // deferred correction is taken on the far side of exactly one pause.
      if (distance >= this.spikeRollbackFrames && this.spikeDeferredFrame !== this.pendingRollbackFrame) {
        this.spikeDeferredFrame = this.pendingRollbackFrame;
        this.pauseFrames = this.spikePauseFrames;
        this.counters.stallSpike++;
        this.onSpike?.({ frame: this.currentFrame, rollbackFrames: distance });
        this.heartbeat();
        return this.stalled("spike", 0);
      }
      rolledBack = this.rollback(this.pendingRollbackFrame);
      this.pendingRollbackFrame = null;
      this.spikeDeferredFrame = null;
    }

    if (this.shouldStallForPrediction()) {
      this.counters.stallPrediction++;
      this.heartbeat();
      return this.stalled("prediction", rolledBack);
    }

    if (this.shouldStallForTimeSync()) {
      this.lastTimeSyncStall = this.currentFrame;
      this.counters.stallTimesync++;
      this.heartbeat();
      return this.stalled("timesync", rolledBack);
    }

    this.scheduleLocal(localInputs);
    this.heartbeat();

    const frame = this.currentFrame;
    this.saveState(frame);
    // Read the previous frame's inputs *before* gathering this one's: they come
    // out of the same history, and `gatherInputs` writes to it.
    const prevInputs = this.previousInputs(frame);
    const inputs = this.gatherInputs(frame);
    const result = this.deps.step(this.state, inputs, prevInputs);
    this.state = result.state;
    this.currentFrame = frame + 1;

    const depth = this.predictionDepth;
    if (depth > this.counters.maxPredictionDepth) this.counters.maxPredictionDepth = depth;

    this.maybeHash();
    this.maybeRetuneDelay();

    return {
      state: this.state,
      events: result.events,
      frame: this.currentFrame,
      advanced: true,
      stallReason: null,
      rolledBackFrames: rolledBack,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
    this.peers.clear();
    this.localHashes.clear();
    this.remoteHashes.clear();
    this.pings.clear();
  }

  /* ---------------------------------------------------------------- inputs -- */

  /**
   * Stamp this frame's local input onto an absolute future frame.
   *
   * The `> highestScheduled` guard is what makes retuning the delay safe. A
   * larger delay leaves a hole, which is backfilled with the same input (the
   * player has not moved in the meantime, and one repeated frame is
   * imperceptible). A smaller delay would land on a frame that has already been
   * scheduled *and sent*; overwriting it would mean the peer and this machine
   * simulate different inputs for one frame, which is a desync. So it is
   * dropped instead. Shrinking the delay costs one input read; getting it wrong
   * would cost the match.
   */
  private scheduleLocal(localInputs: InputFrame | readonly InputFrame[]): void {
    const target = this.currentFrame + this.inputDelay;
    if (target <= this.highestScheduled) return;

    for (const port of this.localPorts) {
      const value = readPortInput(localInputs, port);
      for (let f = this.highestScheduled + 1; f <= target; f++) {
        this.inputs[port].set(f, value);
      }
    }
    this.highestScheduled = target;
  }

  /**
   * Assemble the input array for one frame, remembering every guess.
   *
   * Recording what was *used* — not merely what was known — is the mechanism
   * that makes rollback cheap: when the real input arrives and happens to match
   * the guess (which it usually does, since the guess is "unchanged"), there is
   * nothing to correct and no work to do.
   */
  private gatherInputs(frame: number): InputFrame[] {
    const inputs: InputFrame[] = new Array(this.playerCount);
    for (let port = 0; port < this.playerCount; port++) {
      const queue = this.inputs[port];
      const known = queue.get(frame);
      const value = known ?? queue.predict(frame);
      inputs[port] = value;
      queue.markUsed(frame, value);
    }
    return inputs;
  }

  /**
   * The inputs the frame *before* this one was simulated with.
   *
   * `step` needs them to tell a press from a hold, and they have to come from
   * the same rollback-aware place as the current frame's or a rewind silently
   * changes what "pressed" means. `usedAt` is exactly that place: it records
   * what each frame was actually stepped with, and a rollback overwrites it as
   * it replays, so frame `f` always sees the inputs that produced the state it
   * is starting from — a predicted value while the guess stands, the corrected
   * one the moment the replay reaches it.
   *
   * Frame 0 has no predecessor, and neutral is the truth rather than a
   * fallback: nothing was held before the match began.
   */
  private previousInputs(frame: number): InputFrame[] {
    const prev: InputFrame[] = new Array(this.playerCount);
    for (let port = 0; port < this.playerCount; port++) {
      if (frame <= 0) {
        prev[port] = NEUTRAL_INPUT;
        continue;
      }
      const queue = this.inputs[port];
      prev[port] = queue.usedAt(frame - 1) ?? queue.get(frame - 1) ?? queue.predict(frame - 1);
    }
    return prev;
  }

  private remoteConfirmedFrame(): number {
    let min = Infinity;
    for (const port of this.remotePorts) min = Math.min(min, this.inputs[port].confirmedThrough);
    return min === Infinity ? this.currentFrame - 1 : min;
  }

  /**
   * Refuse to guess any further.
   *
   * Note there is no "wait until a peer connects" exemption. A session
   * configured with remote ports that has heard nothing stalls at frame
   * `maxPrediction`, which is precisely the behaviour a match needs at its
   * start: both machines sit at the same frame until the first packets cross,
   * then advance together. Exempting the unconnected case would let one side
   * run three hundred frames ahead of a peer that has no way to catch up.
   */
  private shouldStallForPrediction(): boolean {
    if (this.remotePorts.length === 0) return false;
    return this.currentFrame - this.remoteConfirmedFrame() > this.maxPrediction;
  }

  /**
   * Give a frame back when we are the one running ahead.
   *
   * The peer's reported frame is stale by roughly half a round trip, so that is
   * added back before comparing. Without the correction every peer would think
   * itself ahead and both would stall, which is a nicely symmetric way to run
   * the game at 40Hz.
   */
  private shouldStallForTimeSync(): boolean {
    if (this.remotePorts.length === 0 || this.peers.size === 0) return false;
    if (this.currentFrame - this.lastTimeSyncStall < TIME_SYNC_COOLDOWN_FRAMES) return false;
    return this.frameAdvantage >= TIME_SYNC_THRESHOLD_FRAMES;
  }

  /* ------------------------------------------------------------ save/restore -- */

  /**
   * Save the state about to be simulated.
   *
   * The slots themselves are preallocated; the state inside one is not, because
   * the injected contract offers `cloneState(state): S` and no way to clone
   * *into* an existing object. One allocation per frame is the price of that
   * signature, and it is the single hazard in this contract worth flagging: a
   * `cloneState` that returns a shallow copy would alias the fighter array into
   * the ring and quietly destroy every saved frame. The tests below assert deep
   * independence for exactly that reason.
   */
  private saveState(frame: number): void {
    const slot = this.saved[frame % this.savedSlots];
    slot.frame = frame;
    slot.state = this.deps.cloneState(this.state);
  }

  private restore(frame: number): S | null {
    const slot = this.saved[frame % this.savedSlots];
    return slot.frame === frame ? slot.state : null;
  }

  /**
   * Rewind to `target` and replay to the present, silently.
   *
   * Every frame in between is re-simulated with the corrected inputs, and every
   * frame's events are thrown away: those frames were already shown once, and
   * their sounds already played. Only the caller's next `advance()` produces
   * events again. This is the concrete meaning of "cosmetic state lives outside
   * `GameState`" in SPEC §3 — if hit sparks lived in the state, this loop would
   * be replaying them.
   */
  private rollback(target: number): number {
    const restored = this.restore(target);
    if (restored === null) {
      // Unreachable while the prediction cap holds: nothing may be simulated
      // more than `maxPrediction` frames past confirmation, and the ring holds
      // two more than that. Counted rather than thrown, because a desync is
      // survivable and a crash mid-match is not.
      this.counters.lateInputs++;
      return 0;
    }

    // Aliasing the slot is safe because `step()` never mutates its argument
    // (SPEC §3 rule 4) and the first step replaces `this.state` outright.
    this.state = restored;
    const distance = this.currentFrame - target;

    for (let f = target; f < this.currentFrame; f++) {
      const prevInputs = this.previousInputs(f);
      const inputs = this.gatherInputs(f);
      this.state = this.deps.step(this.state, inputs, prevInputs).state;
      if (f + 1 < this.currentFrame) this.saveState(f + 1);
    }

    this.counters.rollbacks++;
    this.counters.rolledBackFrames += distance;
    if (distance > this.counters.maxRollbackFrames) this.counters.maxRollbackFrames = distance;
    return distance;
  }

  /* -------------------------------------------------------------- transport -- */

  /** One packet per local port, plus a ping on the cadence. Sent every frame,
   *  stalled or not — a stalled peer that goes quiet looks like a dead one. */
  private heartbeat(): void {
    for (const port of this.localPorts) this.sendInputWindow(port);
    this.maybePing();
  }

  private sendInputWindow(port: number): void {
    if (this.highestScheduled < 0) return;
    const end = this.highestScheduled;
    const start = Math.max(0, end - INPUT_WINDOW_FRAMES + 1);
    const queue = this.inputs[port];
    const window: InputFrame[] = [];
    for (let f = start; f <= end; f++) window.push(queue.get(f) ?? NEUTRAL_INPUT);
    this.emit({
      type: PacketType.Input,
      port,
      senderFrame: this.currentFrame,
      startFrame: start,
      inputs: window,
    });
  }

  private maybePing(): void {
    if (this.peers.size === 0) return;
    if (this.currentFrame - this.lastPingFrame < this.pingInterval) return;
    this.lastPingFrame = this.currentFrame;
    const token = this.pingToken++ >>> 0;
    this.pings.set(token, this.now());
    // Bounded: a peer that never pongs would otherwise leak one entry every
    // half second for the length of the match.
    if (this.pings.size > 16) {
      const oldest = this.pings.keys().next();
      if (!oldest.done) this.pings.delete(oldest.value);
    }
    this.emit({ type: PacketType.Ping, token });
  }

  private emit(packet: Packet): void {
    this.transport.send(encodePacket(packet));
    this.counters.packetsSent++;
  }

  private receive(bytes: Uint8Array, peerId: string): void {
    if (this.closed) return;
    const packet = decodePacket(bytes);
    if (packet === null) {
      this.counters.packetsRejected++;
      return;
    }
    this.counters.packetsReceived++;

    let peer = this.peers.get(peerId);
    if (!peer) {
      // A packet from an unannounced peer is still a peer. Adapters differ on
      // whether join fires before the first message, and the session must not
      // depend on which.
      peer = { id: peerId, ports: new Set(), lastPacketFrame: -1 };
      this.peers.set(peerId, peer);
      this.onPeerJoinCb?.(peerId);
    }

    switch (packet.type) {
      case PacketType.Input:
        this.applyInputPacket(packet, peer);
        break;
      case PacketType.Ping:
        this.emit({ type: PacketType.Pong, token: packet.token });
        break;
      case PacketType.Pong: {
        const sentAt = this.pings.get(packet.token);
        if (sentAt === undefined) break;
        this.pings.delete(packet.token);
        const sample = Math.max(0, this.now() - sentAt);
        // Exponential average. A single spike should not retune the input
        // delay, and a sustained change should reach it within a second.
        this.rttMs = this.rttSamples === 0 ? sample : this.rttMs * 0.8 + sample * 0.2;
        this.rttSamples++;
        break;
      }
      case PacketType.Hash:
        this.remoteHashes.set(packet.frame, {
          hash: packet.hash,
          peerId,
          port: packet.port,
        });
        this.compareHashes(packet.frame);
        break;
    }
  }

  private applyInputPacket(packet: InputPacket, peer: PeerInfo): void {
    const port = packet.port;
    if (port < 0 || port >= this.playerCount) return;
    if (this.localPorts.includes(port)) return; // our own port echoed back
    peer.ports.add(port);
    peer.lastPacketFrame = packet.senderFrame;

    const queue = this.inputs[port];
    let earliestMismatch: number | null = null;

    for (let i = 0; i < packet.inputs.length; i++) {
      const frame = packet.startFrame + i;
      const input = packet.inputs[i];
      const outcome = queue.set(frame, input);
      if (outcome === "conflict") {
        this.counters.inputConflicts++;
        continue;
      }
      if (outcome === "duplicate") continue;

      // A frame we have already simulated: did we guess it right?
      if (frame < this.currentFrame) {
        const used = queue.usedAt(frame);
        if (used !== null && used !== input) {
          if (frame <= this.currentFrame - this.savedSlots) {
            // Beyond the ring. Cannot be corrected — record it loudly.
            this.counters.lateInputs++;
          } else if (earliestMismatch === null || frame < earliestMismatch) {
            earliestMismatch = frame;
          }
        }
      }
    }

    if (earliestMismatch !== null) {
      this.pendingRollbackFrame =
        this.pendingRollbackFrame === null
          ? earliestMismatch
          : Math.min(this.pendingRollbackFrame, earliestMismatch);
    }

    // Time sync. The sender's frame is stale by about half a round trip, so
    // that is added back before asking who is ahead.
    const rttFrames = this.rttMs / 2 / FRAME_MS;
    const advantage = this.currentFrame - (packet.senderFrame + rttFrames);
    this.frameAdvantage = this.frameAdvantage * 0.7 + advantage * 0.3;
  }

  /* ------------------------------------------------------- desync detection -- */

  /**
   * Hash a fully-confirmed frame twice a second and trade it with the peer.
   *
   * Only *settled* frames are eligible, and settled means two things, not one.
   * Every input before frame `f` must be known — the state at `f` is final once
   * that holds, which is `confirmedFrame + 1`. And no correction may be
   * outstanding: input that arrives for an already-simulated frame advances the
   * confirmed marker immediately, but the state itself is not repaired until
   * the next `advance()` performs the rollback. Hashing in that window compares
   * a state this machine is about to throw away, and reports a desync on a
   * perfectly healthy connection — which is exactly what it did before the
   * `pendingRollbackFrame` guard below was added.
   *
   * A mismatch is reported rather than repaired. Repair would mean shipping
   * state over the wire, and a rollback netcode that can resynchronise from a
   * state transfer is a different (and much larger) program. What matters is
   * that the two players are told, instead of playing out two different matches
   * and disagreeing about who won.
   */
  private maybeHash(): void {
    if (this.remotePorts.length === 0) return;
    if (this.pendingRollbackFrame !== null) return;
    // A peer running ahead can confirm frames we have not reached; those are
    // not ours to hash yet.
    const final = Math.min(this.confirmedFrame + 1, this.currentFrame);
    if (final < 0) return;
    // Walk any interval boundaries that became final since the last check.
    for (
      let f = Math.floor(final / this.hashInterval) * this.hashInterval;
      f <= final;
      f += this.hashInterval
    ) {
      if (f <= 0 || this.localHashes.has(f)) continue;
      const state = f === this.currentFrame ? this.state : this.restore(f);
      if (state === null) continue;
      const hash = this.deps.hashState(state) >>> 0;
      this.localHashes.set(f, hash);
      this.emit({
        type: PacketType.Hash,
        port: this.localPorts[0] ?? 0,
        frame: f,
        hash,
      });
      this.compareHashes(f);
      break;
    }
    this.pruneHashes();
  }

  private compareHashes(frame: number): void {
    const local = this.localHashes.get(frame);
    const remote = this.remoteHashes.get(frame);
    if (local === undefined || remote === undefined) return;
    this.remoteHashes.delete(frame);
    this.counters.hashesCompared++;
    if (local === remote.hash) return;
    this.counters.desyncs++;
    this.onDesync?.({
      frame,
      localHash: local,
      remoteHash: remote.hash,
      peerId: remote.peerId,
      port: remote.port,
    });
  }

  private pruneHashes(): void {
    const cutoff = this.currentFrame - this.hashInterval * 10;
    if (cutoff <= 0) return;
    for (const f of this.localHashes.keys()) if (f < cutoff) this.localHashes.delete(f);
    for (const f of this.remoteHashes.keys()) if (f < cutoff) this.remoteHashes.delete(f);
  }

  /* ----------------------------------------------------------- delay tuning -- */

  /**
   * Match the delay to the measured connection.
   *
   * Enough delay that the opponent's input usually lands before it is needed;
   * no more, because every frame of delay is a frame of input lag the player
   * feels on *every* input, whereas a rollback is only felt when the prediction
   * was wrong. Two frames is the floor because it costs 33ms and removes almost
   * all rollbacks on a LAN.
   *
   * Raised immediately and lowered reluctantly: a connection that just got
   * worse should be covered now, and a connection that looks better for half a
   * second has not proven anything yet.
   */
  private maybeRetuneDelay(): void {
    if (!this.autoInputDelay || this.rttSamples < 2) return;
    const oneWayFrames = this.rttMs / 2 / FRAME_MS;
    const target = clampInt(Math.ceil(oneWayFrames), DEFAULT_INPUT_DELAY, MAX_INPUT_DELAY);
    if (target === this.inputDelay) return;
    const cooldown = target > this.inputDelay ? 0 : 60;
    if (this.currentFrame - this.lastDelayChangeFrame < cooldown) return;
    this.inputDelay = target;
    this.lastDelayChangeFrame = this.currentFrame;
  }

  /* ----------------------------------------------------------------- helper -- */

  private stalled(reason: StallReason, rolledBack: number): AdvanceResult<S> {
    return {
      state: this.state,
      events: emptyEvents(),
      frame: this.currentFrame,
      advanced: false,
      stallReason: reason,
      rolledBackFrames: rolledBack,
    };
  }
}

/* ----------------------------------------------------------------- helpers -- */

function readPortInput(inputs: InputFrame | readonly InputFrame[], port: number): InputFrame {
  if (typeof inputs === "number") return inputs;
  return inputs[port] ?? NEUTRAL_INPUT;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function defaultClock(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
