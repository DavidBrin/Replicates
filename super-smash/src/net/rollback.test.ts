/**
 * The rollback tests.
 *
 * These run two real sessions against each other over the loopback network,
 * with a fake simulation standing in for the engine. The fake is deliberately
 * hostile: its state depends on every input at every frame, and on the order
 * they were applied, so *any* incorrect input — one frame, one button, one
 * player — changes the final hash. A rollback bug therefore shows up as a
 * mismatched number rather than as a fighter standing somewhere plausible.
 *
 * The property under test throughout is the one that makes rollback netcode
 * legitimate rather than merely convincing: **the state a peer arrives at is
 * the state a single machine with no network would have arrived at, given the
 * same inputs.** Everything else — how many rollbacks happened, how deep they
 * went — is performance. This is correctness.
 */

import { describe, expect, it, vi } from "vitest";

import { Btn, emptyEvents, pressed, type InputFrame, type StepEvents } from "@/engine/types";
import { LoopbackNetwork } from "./adapters/loopback";
import { createNullTransport } from "./transport";
import {
  MAX_PREDICTION_FRAMES,
  MAX_PREDICTION_FRAMES_LIMIT,
  RollbackSession,
  SAVED_STATE_SLOTS,
  type RollbackDeps,
} from "./rollback";

const FRAME_MS = 1000 / 60;

/* ------------------------------------------------------- the fake simulation -- */

interface FakeState {
  frame: number;
  /** One accumulator per port, folded with a non-commutative mix. */
  acc: number[];
}

function initialState(playerCount = 2): FakeState {
  return { frame: 0, acc: new Array(playerCount).fill(0x1234_5678) };
}

/**
 * Order- and input-sensitive, and cheap.
 *
 * Multiplying by a large odd constant and mixing in the frame number means two
 * inputs swapped between frames produce different accumulators, which is the
 * property a rollback test needs: replaying with the right inputs in the wrong
 * order must not accidentally pass.
 */
function mix(previous: number, input: number, frame: number, port: number): number {
  let h = previous ^ (input + 0x9e37_79b9 + (frame << 6) + port);
  h = Math.imul(h ^ (h >>> 16), 0x85eb_ca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35);
  return (h ^ (h >>> 16)) | 0;
}

/**
 * The fake simulation, which cares about *edges* exactly as the real one does.
 *
 * `prevInputs` is folded into the accumulator, not merely read, so a session
 * that supplies the wrong previous frame — or supplies this frame's inputs as
 * its own predecessor, which is what an absent parameter degenerates to —
 * produces a different hash rather than a plausible one. And the event is a
 * *press*, not a hold, which is the distinction that stopped every button in a
 * netplay match from working at all.
 */
function makeDeps(overrides: Partial<RollbackDeps<FakeState>> = {}): RollbackDeps<FakeState> {
  return {
    step(state, inputs, prevInputs) {
      const events = emptyEvents();
      const acc = state.acc.map((value, port) =>
        mix(mix(value, inputs[port] ?? 0, state.frame, port), prevInputs[port] ?? 0, state.frame, port),
      );
      // An "event" that a naive implementation would replay on every rollback.
      for (let port = 0; port < inputs.length; port++) {
        if (pressed(inputs[port] ?? 0, prevInputs[port] ?? 0, Btn.Attack)) {
          events.hits.push({ attacker: port, victim: 1 - port, damage: 1, x: 0, y: 0, knockback: 1, angle: 0, hitboxId: 0 });
        }
      }
      return { state: { frame: state.frame + 1, acc }, events };
    },
    cloneState: (state) => ({ frame: state.frame, acc: [...state.acc] }),
    hashState: (state) => {
      let h = state.frame | 0;
      for (const value of state.acc) h = Math.imul(h ^ value, 0x0100_0193) | 0;
      return h >>> 0;
    },
    ...overrides,
  };
}

/* ---------------------------------------------------------------- the script -- */

/**
 * What each player presses, as a function of the frame they press it on.
 *
 * Deliberately busy and deliberately different per port: buttons change every
 * few frames, so the "repeat the last input" prediction is wrong regularly
 * enough to exercise the rewind path, but not so often that the test is really
 * about a pathological input stream.
 *
 * After `quietAfter` everybody stops pressing. That tail matters: with a
 * constant input the prediction is always right, so every outstanding
 * correction lands and the session's current state becomes final. Comparing a
 * *provisional* state against the reference would be comparing a guess.
 */
function scriptedInput(port: number, readFrame: number, quietAfter: number): InputFrame {
  if (readFrame >= quietAfter) return 0;
  const phase = (readFrame + port * 7) % 23;
  let input = 0;
  if (phase < 6) input |= Btn.Right;
  else if (phase < 11) input |= Btn.Left;
  if (phase % 5 === 0) input |= Btn.Attack;
  if (phase % 7 === 3) input |= Btn.Jump;
  if (phase % 11 === 9) input |= Btn.Shield;
  return input;
}

/**
 * The ground truth: one machine, no network, the same inputs at the same
 * absolute frames.
 *
 * Input delay is folded in here rather than ignored, because delay genuinely
 * changes the match — an input read on frame 10 with two frames of delay is an
 * input that happened on frame 12. What must not change is the *result* of
 * playing that match, whatever the network did on the way.
 */
function referenceState(
  frames: number,
  delay: number,
  quietAfter: number,
  deps: RollbackDeps<FakeState>,
): FakeState {
  const inputsAt = (frame: number): InputFrame[] =>
    [0, 1].map((port) =>
      frame - delay < 0 ? 0 : scriptedInput(port, frame - delay, quietAfter),
    );
  let state = initialState();
  for (let frame = 0; frame < frames; frame++) {
    // Frame 0 has no predecessor: nothing was held before the match started.
    state = deps.step(state, inputsAt(frame), frame === 0 ? [0, 0] : inputsAt(frame - 1)).state;
  }
  return state;
}

/* ----------------------------------------------------------------- the harness -- */

interface MatchOptions {
  latencyMs?: number;
  jitterMs?: number;
  lossRate?: number;
  seed?: number;
  frames?: number;
  /** Frames of quiet at the end, so every correction has landed. */
  tailFrames?: number;
  inputDelay?: number;
  maxPredictionFrames?: number;
  depsB?: RollbackDeps<FakeState>;
  onDesyncA?: (report: unknown) => void;
  onSpikeA?: (info: unknown) => void;
}

function runMatch(options: MatchOptions = {}) {
  const frames = options.frames ?? 240;
  const tail = options.tailFrames ?? 90;
  const total = frames + tail;
  const delay = options.inputDelay ?? 2;
  const depsA = makeDeps();
  const depsB = options.depsB ?? makeDeps();

  const network = new LoopbackNetwork({
    latencyMs: options.latencyMs ?? 0,
    jitterMs: options.jitterMs ?? 0,
    lossRate: options.lossRate ?? 0,
    seed: options.seed ?? 0xc0ffee,
  });

  const common = {
    playerCount: 2,
    inputDelay: delay,
    // Fixed for the duration. Auto-tuning is correct in a real match and would
    // make this comparison meaningless: it changes which absolute frame an
    // input lands on, so the two runs would be playing different matches.
    autoInputDelay: false,
    maxPredictionFrames: options.maxPredictionFrames,
    now: () => network.now(),
  } as const;

  const a = new RollbackSession<FakeState>({
    ...common,
    transport: network.connect("A"),
    deps: depsA,
    initialState: initialState(),
    localPorts: [0],
    onDesync: options.onDesyncA,
    onSpike: options.onSpikeA,
  });
  const b = new RollbackSession<FakeState>({
    ...common,
    transport: network.connect("B"),
    deps: depsB,
    initialState: initialState(),
    localPorts: [1],
  });

  let iterations = 0;
  const budget = total * 6;
  while ((a.frame < total || b.frame < total) && iterations++ < budget) {
    if (a.frame < total) a.advance(scriptedInput(0, a.frame, frames));
    if (b.frame < total) b.advance(scriptedInput(1, b.frame, frames));
    network.advance(FRAME_MS);
  }
  network.flush();

  return {
    a,
    b,
    network,
    depsA,
    depsB,
    delay,
    quietAfter: frames,
    stalledOut: iterations >= budget,
    /** Does this session hold the state a lone machine would have reached? */
    matchesReference(session: RollbackSession<FakeState>, deps = depsA): boolean {
      const expected = referenceState(session.frame, delay, frames, deps);
      return deps.hashState(session.currentState) === deps.hashState(expected);
    },
  };
}

/* --------------------------------------------------------------------- tests -- */

describe("a perfect connection", () => {
  it("never rolls back and never predicts", () => {
    // With zero latency the opponent's input for frame f is already in hand
    // when frame f is simulated, so the rewind path is dead code. This is what
    // input delay buys on a good connection, and why the default is not zero.
    const match = runMatch({ latencyMs: 0, frames: 300 });

    expect(match.stalledOut).toBe(false);
    expect(match.a.stats().rollbacks).toBe(0);
    expect(match.b.stats().rollbacks).toBe(0);
    expect(match.a.stats().maxPredictionDepth).toBe(0);
    expect(match.b.stats().maxPredictionDepth).toBe(0);
    expect(match.a.stats().stalls).toEqual({ prediction: 0, timesync: 0, spike: 0 });
  });

  it("arrives at the state a lone machine would have", () => {
    const match = runMatch({ latencyMs: 0, frames: 300 });
    expect(match.matchesReference(match.a)).toBe(true);
    expect(match.matchesReference(match.b)).toBe(true);
  });
});

describe("a hundred milliseconds of latency", () => {
  it("mispredicts, rewinds, and converges on the no-latency result", () => {
    const match = runMatch({ latencyMs: 100, frames: 300 });

    expect(match.stalledOut).toBe(false);
    // The point of the test: it really did roll back, repeatedly.
    expect(match.a.stats().rollbacks).toBeGreaterThan(10);
    expect(match.b.stats().rollbacks).toBeGreaterThan(10);
    expect(match.matchesReference(match.a)).toBe(true);
    expect(match.matchesReference(match.b)).toBe(true);
  });

  it("agrees with its peer, frame for frame", () => {
    const match = runMatch({ latencyMs: 100, frames: 300 });
    expect(match.a.frame).toBe(match.b.frame);
    expect(match.depsA.hashState(match.a.currentState)).toBe(
      match.depsB.hashState(match.b.currentState),
    );
    expect(match.a.stats().desyncs).toBe(0);
    expect(match.a.stats().hashesCompared).toBeGreaterThan(0);
  });

  it("survives jitter reordering the packets", () => {
    const match = runMatch({ latencyMs: 60, jitterMs: 40, frames: 300 });
    expect(match.stalledOut).toBe(false);
    expect(match.matchesReference(match.a)).toBe(true);
    expect(match.matchesReference(match.b)).toBe(true);
  });
});

describe("packet loss", () => {
  it("heals itself from the redundant input window", () => {
    // Nothing retransmits. Every recovery here is a later packet carrying the
    // same frame again, which is the entire argument for the ten-frame window.
    const match = runMatch({ latencyMs: 50, lossRate: 0.1, frames: 300, seed: 0xbadbeef });

    expect(match.network.counts.dropped).toBeGreaterThan(50);
    expect(match.stalledOut).toBe(false);
    expect(match.matchesReference(match.a)).toBe(true);
    expect(match.matchesReference(match.b)).toBe(true);
    expect(match.a.stats().lateInputs).toBe(0);
    expect(match.a.stats().inputConflicts).toBe(0);
  });

  it("still converges when a third of the packets are gone", () => {
    const match = runMatch({ latencyMs: 50, lossRate: 0.33, frames: 240, seed: 0x51de });
    expect(match.stalledOut).toBe(false);
    expect(match.matchesReference(match.a)).toBe(true);
    expect(match.matchesReference(match.b)).toBe(true);
  });
});

describe("the prediction cap", () => {
  it("never guesses more than eight frames ahead, however bad the link", () => {
    for (const options of [
      { latencyMs: 100 },
      { latencyMs: 200, jitterMs: 60 },
      { latencyMs: 120, lossRate: 0.2, seed: 0x1234 },
    ]) {
      const match = runMatch({ ...options, frames: 200 });
      expect(match.a.stats().maxPredictionDepth).toBeLessThanOrEqual(MAX_PREDICTION_FRAMES);
      expect(match.b.stats().maxPredictionDepth).toBeLessThanOrEqual(MAX_PREDICTION_FRAMES);
    }
  });

  it("stalls rather than guessing when the peer goes silent", () => {
    const network = new LoopbackNetwork();
    const deps = makeDeps();
    const session = new RollbackSession<FakeState>({
      transport: network.connect("A"),
      deps,
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0],
      inputDelay: 2,
      autoInputDelay: false,
      now: () => network.now(),
    });
    // A peer exists but never speaks — the worst case, because the session
    // cannot tell "thinking" from "gone" and must not run away.
    network.connect("B");

    const reasons: (string | null)[] = [];
    for (let i = 0; i < 40; i++) {
      reasons.push(session.advance(0).stallReason);
      network.advance(FRAME_MS);
    }

    // Frame 0 is neutral for every port by construction, so it is confirmed
    // without a packet; frames 1 through 8 are the eight guesses the cap
    // allows. The ninth would be the ninth guess, and never happens.
    expect(session.frame).toBe(MAX_PREDICTION_FRAMES + 1);
    expect(session.stats().maxPredictionDepth).toBe(MAX_PREDICTION_FRAMES);
    expect(session.stats().stalls.prediction).toBeGreaterThan(20);
    expect(reasons.slice(-5)).toEqual(new Array(5).fill("prediction"));
  });

  it("keeps every rollback inside the saved-state ring", () => {
    // The cap is what makes ten slots sufficient. If a rollback ever needed a
    // frame the ring had evicted, it would be silently uncorrectable — which
    // is what `lateInputs` counts.
    const match = runMatch({ latencyMs: 130, jitterMs: 30, frames: 240 });
    expect(match.a.stats().maxRollbackFrames).toBeLessThan(SAVED_STATE_SLOTS);
    expect(match.a.stats().lateInputs).toBe(0);
    expect(match.b.stats().lateInputs).toBe(0);
  });

  it("grows the ring with the cap, so a raised cap cannot outrun its own snapshots", () => {
    // A configurable cap against a fixed ten-slot ring was a silent corruption:
    // past ten frames of prediction a late input targets a snapshot that has
    // been evicted, the correction is abandoned, and the session carries on
    // from state it *knows* is wrong — one counter incremented, nothing said,
    // two peers now playing different matches. The ring is sized from the cap
    // instead, so the deepest legal rollback always has a frame to return to.
    const match = runMatch({
      latencyMs: 300,
      frames: 200,
      maxPredictionFrames: 40,
      tailFrames: 200,
    });
    expect(match.a.stats().lateInputs).toBe(0);
    expect(match.b.stats().lateInputs).toBe(0);
    // …and it really did roll back further than the default ring could hold.
    expect(match.a.stats().maxRollbackFrames).toBeGreaterThan(SAVED_STATE_SLOTS);
    expect(match.matchesReference(match.a)).toBe(true);
    expect(match.matchesReference(match.b)).toBe(true);
  });

  it("clamps a cap the input history cannot serve", () => {
    // The ring can be grown; the 256-frame input history cannot, and replaying
    // a frame whose inputs have been overwritten is the same silent corruption
    // by another route. So the cap is bounded rather than trusted.
    const session = new RollbackSession<FakeState>({
      transport: createNullTransport(),
      deps: makeDeps(),
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0],
      maxPredictionFrames: 100_000,
      autoInputDelay: false,
    });
    // A peer exists on paper but never speaks, so the session runs to the cap
    // and stops — and where it stops is the clamp.
    for (let i = 0; i < MAX_PREDICTION_FRAMES_LIMIT + 50; i++) session.advance(0);
    expect(session.frame).toBeLessThanOrEqual(MAX_PREDICTION_FRAMES_LIMIT + 1);
  });
});

describe("time sync", () => {
  it("holds a peer back rather than letting it drift ahead", () => {
    // B is only allowed to run every other iteration, so A is naturally the
    // faster machine. Left uncorrected, A would sit permanently at the
    // prediction cap; the frame-advantage exchange should stop that.
    const network = new LoopbackNetwork({ latencyMs: 30 });
    const deps = makeDeps();
    const make = (id: string, port: number) =>
      new RollbackSession<FakeState>({
        transport: network.connect(id),
        deps,
        initialState: initialState(),
        playerCount: 2,
        localPorts: [port],
        inputDelay: 2,
        autoInputDelay: false,
        now: () => network.now(),
      });
    const a = make("A", 0);
    const b = make("B", 1);

    for (let i = 0; i < 600; i++) {
      a.advance(scriptedInput(0, a.frame, 10_000));
      if (i % 2 === 0) b.advance(scriptedInput(1, b.frame, 10_000));
      network.advance(FRAME_MS);
    }

    expect(a.stats().stalls.timesync).toBeGreaterThan(0);
    // A cannot outrun B by more than the prediction window regardless, but the
    // point is that it gave frames back voluntarily along the way.
    expect(a.frame - b.frame).toBeLessThanOrEqual(MAX_PREDICTION_FRAMES + 1);
  });
});

describe("the spike hatch", () => {
  it("freezes instead of attempting a deep resimulation", () => {
    const onSpike = vi.fn();
    const match = runMatch({
      latencyMs: 150,
      jitterMs: 40,
      frames: 240,
      onSpikeA: onSpike,
      tailFrames: 150,
    });

    expect(onSpike).toHaveBeenCalled();
    expect(match.a.stats().stalls.spike).toBeGreaterThan(0);
    // Having frozen, it still lands on the correct state — a pause is a
    // presentation decision, never a correctness one.
    expect(match.matchesReference(match.a)).toBe(true);
  });
});

describe("desync detection", () => {
  it("catches a peer whose simulation diverges", () => {
    const onDesync = vi.fn();
    // B's simulation is subtly wrong from frame 50 — the shape of a real
    // desync, where two builds disagree about one formula.
    const brokenDeps = makeDeps();
    const honest = brokenDeps.step.bind(brokenDeps);
    brokenDeps.step = (state, inputs, prevInputs) => {
      const result = honest(state, inputs, prevInputs);
      if (state.frame === 50) result.state.acc[0] ^= 1;
      return result;
    };

    const match = runMatch({
      latencyMs: 40,
      frames: 200,
      depsB: brokenDeps,
      onDesyncA: onDesync,
    });

    expect(onDesync).toHaveBeenCalled();
    const report = onDesync.mock.calls[0][0] as { frame: number; localHash: number; remoteHash: number };
    expect(report.frame).toBeGreaterThanOrEqual(60);
    expect(report.localHash).not.toBe(report.remoteHash);
    expect(match.a.stats().desyncs).toBeGreaterThan(0);
  });

  it("says nothing when the two simulations agree", () => {
    const onDesync = vi.fn();
    const match = runMatch({ latencyMs: 80, lossRate: 0.05, frames: 300, onDesyncA: onDesync });
    expect(onDesync).not.toHaveBeenCalled();
    // …and it was actually looking. A detector that never compares anything
    // also never reports anything.
    expect(match.a.stats().hashesCompared).toBeGreaterThan(5);
  });

  it("compares only confirmed frames, so a rollback is not mistaken for a desync", () => {
    // Rollbacks are frequent here; every one of them means the two peers held
    // different *provisional* states for a while. That must not be reported.
    const onDesync = vi.fn();
    const match = runMatch({ latencyMs: 110, jitterMs: 30, frames: 300, onDesyncA: onDesync });
    expect(match.a.stats().rollbacks).toBeGreaterThan(5);
    expect(onDesync).not.toHaveBeenCalled();
  });
});

describe("events", () => {
  it("reports a frame's events once, however many times the frame is simulated", () => {
    // The requirement from SPEC §3: re-simulating eight frames must not replay
    // eight explosions. Every event the caller sees comes from the newest
    // frame; replayed frames report nothing.
    const deps = makeDeps();
    const stepCalls: number[] = [];
    const counted: RollbackDeps<FakeState> = {
      ...deps,
      step(state, inputs, prevInputs) {
        stepCalls.push(state.frame);
        return deps.step(state, inputs, prevInputs);
      },
    };

    const network = new LoopbackNetwork({ latencyMs: 100 });
    const a = new RollbackSession<FakeState>({
      transport: network.connect("A"),
      deps: counted,
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0],
      inputDelay: 2,
      autoInputDelay: false,
      now: () => network.now(),
    });
    const b = new RollbackSession<FakeState>({
      transport: network.connect("B"),
      deps: makeDeps(),
      initialState: initialState(),
      playerCount: 2,
      localPorts: [1],
      inputDelay: 2,
      autoInputDelay: false,
      now: () => network.now(),
    });

    const seen: StepEvents[] = [];
    for (let i = 0; i < 300; i++) {
      const result = a.advance(scriptedInput(0, a.frame, 10_000));
      if (result.advanced) seen.push(result.events);
      b.advance(scriptedInput(1, b.frame, 10_000));
      network.advance(FRAME_MS);
    }

    expect(a.stats().rollbacks).toBeGreaterThan(0);
    // Frames were simulated many more times than they were reported.
    expect(stepCalls.length).toBeGreaterThan(a.frame);
    expect(seen.length).toBe(a.frame);
    // And a stalled frame reports nothing at all.
    expect(seen.every((events) => events.hits.length <= 2)).toBe(true);
  });
});

describe("input delay", () => {
  it("applies a local input `delay` frames after it was read", () => {
    const applied: InputFrame[][] = [];
    const deps = makeDeps();
    const recording: RollbackDeps<FakeState> = {
      ...deps,
      step(state, inputs, prevInputs) {
        applied[state.frame] = [...inputs];
        return deps.step(state, inputs, prevInputs);
      },
    };
    const session = new RollbackSession<FakeState>({
      transport: createNullTransport(),
      deps: recording,
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0, 1],
      inputDelay: 3,
      autoInputDelay: false,
    });

    for (let frame = 0; frame < 10; frame++) session.advance([frame + 1, 100 + frame]);

    expect(applied.slice(0, 3)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(applied[3]).toEqual([1, 100]);
    expect(applied[9]).toEqual([7, 106]);
  });

  it("rises with measured round-trip time and never exceeds the cap", () => {
    const network = new LoopbackNetwork({ latencyMs: 90 });
    const deps = makeDeps();
    const make = (id: string, port: number) =>
      new RollbackSession<FakeState>({
        transport: network.connect(id),
        deps,
        initialState: initialState(),
        playerCount: 2,
        localPorts: [port],
        autoInputDelay: true,
        now: () => network.now(),
      });
    const a = make("A", 0);
    const b = make("B", 1);

    for (let i = 0; i < 400; i++) {
      a.advance(0);
      b.advance(0);
      network.advance(FRAME_MS);
    }

    expect(a.stats().rttMs).toBeGreaterThan(150);
    // 90ms one way is between five and six frames; the delay should cover it.
    expect(a.delay).toBeGreaterThan(2);
    expect(a.delay).toBeLessThanOrEqual(8);
  });
});

describe("a session with nobody on the other end", () => {
  it("runs every frame and matches the reference exactly", () => {
    // Local play and CPU matches take this path. One code path through the
    // simulation, whether or not anybody else is playing.
    const deps = makeDeps();
    const session = new RollbackSession<FakeState>({
      transport: createNullTransport(),
      deps,
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0, 1],
      inputDelay: 2,
      autoInputDelay: false,
    });

    for (let frame = 0; frame < 200; frame++) {
      const result = session.advance([
        scriptedInput(0, frame, 10_000),
        scriptedInput(1, frame, 10_000),
      ]);
      expect(result.advanced).toBe(true);
      expect(result.rolledBackFrames).toBe(0);
    }

    expect(session.frame).toBe(200);
    expect(deps.hashState(session.currentState)).toBe(
      deps.hashState(referenceState(200, 2, 10_000, deps)),
    );
    expect(session.stats().rollbacks).toBe(0);
  });
});

describe("the injected simulation contract", () => {
  it("clones on every frame, and restores an independent state", () => {
    const deps = makeDeps();
    let clones = 0;
    const counting: RollbackDeps<FakeState> = {
      ...deps,
      cloneState(state) {
        clones++;
        return deps.cloneState(state);
      },
    };
    const session = new RollbackSession<FakeState>({
      transport: createNullTransport(),
      deps: counting,
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0, 1],
      autoInputDelay: false,
    });

    for (let frame = 0; frame < 50; frame++) session.advance([0, 0]);
    expect(clones).toBe(50);
  });

  it("never hands the same state object to step twice", () => {
    // A `cloneState` returning a shallow copy would alias the saved ring into
    // the live state and destroy every restore point. The session cannot
    // detect that itself, so this asserts the shape it depends on.
    const deps = makeDeps();
    const seen = new Set<FakeState>();
    let duplicated = false;
    const watching: RollbackDeps<FakeState> = {
      ...deps,
      step(state, inputs, prevInputs) {
        if (seen.has(state)) duplicated = true;
        seen.add(state);
        return deps.step(state, inputs, prevInputs);
      },
    };
    const network = new LoopbackNetwork({ latencyMs: 80 });
    const a = new RollbackSession<FakeState>({
      transport: network.connect("A"),
      deps: watching,
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0],
      autoInputDelay: false,
      now: () => network.now(),
    });
    const b = new RollbackSession<FakeState>({
      transport: network.connect("B"),
      deps: makeDeps(),
      initialState: initialState(),
      playerCount: 2,
      localPorts: [1],
      autoInputDelay: false,
      now: () => network.now(),
    });

    for (let i = 0; i < 200; i++) {
      a.advance(scriptedInput(0, a.frame, 10_000));
      b.advance(scriptedInput(1, b.frame, 10_000));
      network.advance(FRAME_MS);
    }

    expect(a.stats().rollbacks).toBeGreaterThan(0);
    expect(duplicated).toBe(false);
  });
});
