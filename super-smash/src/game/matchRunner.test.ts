/**
 * The seam's own tests.
 *
 * `matchRunner` is the only module between the pure simulation and the browser,
 * and it is the module that shipped without a test file — which is exactly why
 * both integration bugs found in play testing lived here rather than in the
 * engine, the renderer or the input layer, all of which are covered thoroughly.
 * Every module it drives is a collaborator it must call *every frame*, and
 * forgetting one is silent: the simulation still advances, the canvas still
 * paints, and the failure only shows up as "the game feels broken".
 *
 * So these tests assert the drive, not the arithmetic. The arithmetic already
 * has tests of its own.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  FRAME_MS,
  createMatchRunner,
  type MatchAudio,
  type MatchRunner,
  type PlayerSlot,
} from "./matchRunner";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
import { meleeReachFromDef } from "@/ai/behaviours";
import { hashState } from "@/engine/hash";
import { Btn, type InputFrame, type MatchOutcome, type MatchRules } from "@/engine/types";
import { LoopbackNetwork } from "@/net/adapters/loopback";
import { MAX_PREDICTION_FRAMES } from "@/net/rollback";
import { ROLE_PORT } from "@/net/signalProtocol";
import { createNullTransport, type Transport } from "@/net/transport";

const RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: 60 * 60 * 7,
  smashBall: false,
  oneOnOne: true,
};

/**
 * Two fighters, no CPU and no keyboard, so every input is zero on every frame.
 * A match that nobody is playing is the strictest possible bed for "does the
 * cosmetic state settle": anything still on screen after the fighters have
 * landed and stopped moving is something that is not being cleaned up.
 */
function idleRunner(audio?: MatchAudio): MatchRunner {
  const players: PlayerSlot[] = [
    { selection: { defId: "mario" }, cpuLevel: null, label: "P1" },
    { selection: { defId: "donkeyKong" }, cpuLevel: null, label: "P2" },
  ];
  return createMatchRunner({
    stage: getStageOrThrow("battlefield"),
    players,
    rules: RULES,
    seed: 0x5eed1e55,
    getFighter: getFighterOrThrow,
    audio,
  });
}

/** Counts the calls the loop is contractually required to make. */
function spyAudio(): MatchAudio & { events: number; shieldCalls: number } {
  return {
    events: 0,
    shieldCalls: 0,
    handleEvents() {
      this.events++;
    },
    setShieldHeld() {
      this.shieldCalls++;
    },
  };
}

beforeAll(() => {
  bootstrapEngine();
});

describe("the runner drives its cosmetic state", () => {
  it("ages the vfx once per simulation frame", () => {
    const runner = idleRunner();
    expect(runner.vfx.frame).toBe(0);

    runner.advance(30);

    // Not "greater than zero" — exactly in step. A vfx clock that advances at a
    // different rate than the simulation would make every particle lifetime,
    // all of which are authored in frames, wrong by that ratio.
    expect(runner.vfx.frame).toBe(30);
    expect(runner.frame).toBe(30);
  });

  it("clears the full-screen KO flash instead of leaving it on the screen", () => {
    const runner = idleRunner();

    // The state a blast-zone KO puts the screen into: `ingestEvents` sets this
    // to 12 and nothing else ever writes it, so if the runner does not age it,
    // a player who loses a stock plays the rest of the match through a white
    // wash. That is precisely the bug this asserts against.
    runner.vfx.koFlash = 12;
    runner.vfx.koFlashMax = 12;

    runner.advance(12);

    expect(runner.vfx.koFlash).toBe(0);
  });

  it("lets hit particles expire rather than accumulating them", () => {
    const runner = idleRunner();

    // Fighters spawn above the stage, so they fall and land within the first
    // second, and a landing spawns dust. Using the match's own particles rather
    // than hand-pushed ones keeps this honest: it proves the real path from
    // `step` → `ingestEvents` → `updateVfx` completes.
    //
    // Sampled every frame rather than read once at the end, because the peak is
    // the *point*: dust lives 16 frames, so a single reading taken after it has
    // already expired cannot tell "cleaned up correctly" from "never spawned",
    // and would pass just as happily against a runner that draws nothing.
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      runner.advance(1);
      peak = Math.max(peak, runner.vfx.particles.length);
    }
    expect(peak).toBeGreaterThan(0);

    // The longest particle authored anywhere in `vfx.ts` is 30 frames (smoke),
    // so twice that with two idle fighters must leave the screen clean.
    runner.advance(60);
    expect(runner.vfx.particles.length).toBe(0);
  });

  it("drives the audio engine every frame", () => {
    // The whole `src/audio` module was unreachable at one point: fully written,
    // fully unit-tested, and imported by nothing, so the game was silent. A
    // module that is correct in isolation and never called is indistinguishable
    // from a module that does not exist, and only the seam can tell them apart.
    const audio = spyAudio();
    const runner = idleRunner(audio);

    runner.advance(20);

    expect(audio.events).toBe(20);
    // Level-triggered, so it is per fighter per frame rather than on an edge.
    expect(audio.shieldCalls).toBe(20 * 2);
  });

  it("runs a match with no audio at all", () => {
    // Sound is optional — a headless test and a browser that refuses to build
    // an AudioContext both land here, and neither should take the match down.
    const runner = idleRunner();
    expect(() => runner.advance(10)).not.toThrow();
  });

  it("clears the per-fighter hit flash", () => {
    const runner = idleRunner();
    runner.vfx.hitFlash[0] = 4;
    runner.vfx.parryFlash[1] = 10;

    runner.advance(10);

    expect(runner.vfx.hitFlash[0]).toBe(0);
    expect(runner.vfx.parryFlash[1]).toBe(0);
  });
});

describe("a CPU's swing range matches its arms", () => {
  // Every fighter, because the threshold was wrong *per fighter*: it came from
  // one roster-wide constant, so whether a CPU could reach depended entirely on
  // whose arms it happened to have.
  const ROSTER = [
    "mario",
    "donkeyKong",
    "link",
    "samus",
    "kirby",
    "fox",
    "marth",
    "pikachu",
  ] as const;

  for (const defId of ROSTER) {
    it(`${defId} never swings from further than it can reach`, () => {
      const def = getFighterOrThrow(defId);
      const reach = meleeReachFromDef(def);

      // The distance the CPU commits to attacking from has to be one both of
      // its default pokes actually cover — it does not get to choose which
      // comes out. A reach longer than either is the whiff deadlock: the CPU
      // stops approaching, starts swinging, connects with nothing, and because
      // the state is then identical next frame, decides the same thing forever.
      for (const slot of ["jab1", "ftilt"] as const) {
        const move = def.moves[slot];
        if (!move || move.hitboxes.length === 0) continue;
        const furthest = Math.max(...move.hitboxes.map((h) => h.x + h.radius));
        expect(reach).toBeLessThanOrEqual(furthest);
      }

      // And a positive one, or the CPU would walk into the opponent and never
      // throw a punch at all — the same deadlock from the other side.
      expect(reach).toBeGreaterThan(0);
    });
  }

});

/** A pad on port 0 whose frame the test sets. */
function fakePad(read: () => InputFrame) {
  return {
    poll(portCount = 4) {
      const frames = new Array<InputFrame>(portCount).fill(0);
      frames[0] = read();
      const none = new Array<InputFrame>(portCount).fill(0);
      return { frames, pressed: none, released: none, sticks: [], connectedPads: [0] };
    },
  };
}

function padRunner(read: () => InputFrame): MatchRunner {
  return createMatchRunner({
    stage: getStageOrThrow("battlefield"),
    players: [
      { selection: { defId: "mario" }, cpuLevel: null, label: "P1" },
      { selection: { defId: "donkeyKong" }, cpuLevel: null, label: "P2" },
    ],
    rules: RULES,
    seed: 0x5eed1e55,
    getFighter: getFighterOrThrow,
    gamepad: fakePad(read),
  });
}

describe("a gamepad drives a local match", () => {
  it("moves port 0 when the stick is pushed", () => {
    let held: InputFrame = 0;
    const runner = padRunner(() => held);
    runner.advance(90);
    const startX = runner.state.fighters[0].x;
    held = Btn.Right;
    runner.advance(30);
    expect(runner.state.fighters[0].x).toBeGreaterThan(startX);
  });

  it("walks on a partial tilt instead of dashing", () => {
    let held: InputFrame = 0;
    const runner = padRunner(() => held);
    runner.advance(90);
    held = Btn.Right | Btn.Soft;
    // Ten frames: well past the 3-frame dash window, and short of the edge of
    // Battlefield's left platform, which Mario walks off at frame 15.
    runner.advance(10);
    expect(runner.state.fighters[0].action).toBe("walk");
  });
});

describe("an online match runs through a RollbackSession", () => {
  const PLAYERS: PlayerSlot[] = [
    { selection: { defId: "mario" }, cpuLevel: null, label: "P1" },
    { selection: { defId: "donkeyKong" }, cpuLevel: null, label: "P2" },
  ];

  function online(transport: Transport, localPort: number, now?: () => number): MatchRunner {
    return createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: PLAYERS,
      rules: RULES,
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      net: { transport, localPorts: [localPort], inputDelay: 2, autoInputDelay: false, now },
    });
  }

  it("keeps both peers on the state one machine reaches, through latency and jitter", () => {
    const network = new LoopbackNetwork({ latencyMs: 40, jitterMs: 10, seed: 7 });
    const a = online(network.connect("A"), 0, () => network.now());
    const b = online(network.connect("B"), 1, () => network.now());
    for (let i = 0; i < 300; i++) {
      a.advance(1);
      b.advance(1);
      network.advance(FRAME_MS);
    }
    expect(a.frame).toBeGreaterThan(200);
    for (const peer of [a, b]) {
      const reference = idleRunner();
      reference.advance(peer.frame);
      expect(hashState(peer.state)).toBe(hashState(reference.state));
    }
    expect(a.netStats?.peers).toBe(1);
    expect(a.netStats?.desyncs).toBe(0);
  });

  it("stalls at the prediction cap while nobody has answered", () => {
    const runner = online(createNullTransport("alone"), 0);
    runner.advance(60);
    expect(runner.frame).toBeLessThanOrEqual(MAX_PREDICTION_FRAMES + 1);
    expect(runner.stalled).toBe(true);
  });

  it("has no rollback stats in a local match", () => {
    expect(idleRunner().netStats).toBeNull();
  });

  it("lets go of the transport on dispose", () => {
    const off = vi.fn();
    const transport: Transport = {
      selfId: "spy",
      send() {},
      onMessage: () => off,
      onPeerJoin: () => off,
      onPeerLeave: () => off,
      close() {},
    };
    online(transport, 0).dispose();
    expect(off).toHaveBeenCalledTimes(3);
  });
});

/** Mario against Donkey Kong, both human, or both the CPU at `cpuLevel`. */
function slots(cpuLevel: number | null): PlayerSlot[] {
  return [
    { selection: { defId: "mario" }, cpuLevel, label: "P1" },
    { selection: { defId: "donkeyKong" }, cpuLevel, label: "P2" },
  ];
}

describe("an online match ends once, on both machines", () => {
  // Two seconds of a timed match: the clock runs out by itself, so the end
  // does not wait on anybody landing a KO.
  const SHORT_TIMED: MatchRules = { ...RULES, mode: "time", timeLimit: 120 };

  /**
   * Host and guest play `frames` ticks, half a frame out of phase as two real
   * machines are, at the input delay production picks for itself. Returns
   * every outcome each side's `onEnd` reported, and both runners.
   */
  function playOut(network: LoopbackNetwork, players: PlayerSlot[], rules: MatchRules, frames: number) {
    const ends: [MatchOutcome[], MatchOutcome[]] = [[], []];
    const peers = (["host", "guest"] as const).map((role) => {
      const port = ROLE_PORT[role];
      return createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players,
        rules,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        net: { transport: network.connect(role), localPorts: [port], now: () => network.now() },
        onEnd: (outcome) => ends[port].push(outcome),
      });
    });
    for (let i = 0; i < frames; i++) {
      peers[0].advance(1);
      network.advance(FRAME_MS / 2);
      peers[1].advance(1);
      network.advance(FRAME_MS / 2);
    }
    return { ends, peers };
  }

  // The peer running ahead is at least a frame past confirmation on every
  // tick. Under "the frame just run is confirmed", its match never ended: at
  // 80 ms the guest never reported a result, at 33 ms the host never did.
  it.each([
    { link: "80 ms", latencyMs: 80, jitterMs: 0 },
    { link: "33 ms", latencyMs: 33, jitterMs: 0 },
    { link: "80 ± 20 ms", latencyMs: 80, jitterMs: 20 },
  ])("reports the result exactly once on each side over $link", ({ latencyMs, jitterMs }) => {
    const network = new LoopbackNetwork({ latencyMs, jitterMs, seed: 11 });
    const {
      ends: [host, guest],
    } = playOut(network, slots(null), SHORT_TIMED, 600);
    expect(host).toHaveLength(1);
    expect(guest).toHaveLength(1);
    expect(host[0]).toEqual(guest[0]);
  });

  it("agrees on the result of a fought match, through rollbacks", () => {
    // Two CPUs stand in for the players. Each machine runs its own port's CPU
    // and sends what it pressed, so the inputs change constantly and the
    // other side's guesses are often wrong.
    const network = new LoopbackNetwork({ latencyMs: 33 });
    const {
      ends: [host, guest],
      peers,
    } = playOut(network, slots(9), { ...RULES, mode: "time", timeLimit: 600 }, 900);
    expect(peers.some((p) => (p.netStats?.rollbacks ?? 0) > 0)).toBe(true);
    expect(host).toHaveLength(1);
    expect(guest).toHaveLength(1);
    expect(host[0]).toEqual(guest[0]);
  });

  it("does not end on an outcome it has only predicted", () => {
    const onEnd = vi.fn();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: slots(null),
      rules: { ...RULES, mode: "time", timeLimit: 3 },
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      net: { transport: createNullTransport("alone"), localPorts: [0] },
      onEnd,
    });
    runner.advance(30);
    // The clock ran out on frames whose guest input was only ever guessed.
    expect(runner.state.outcome).not.toBeNull();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe("dispose is final", () => {
  it("polls nothing and reports nothing afterwards", () => {
    const pad = fakePad(() => Btn.Right);
    const poll = vi.fn((portCount?: number) => pad.poll(portCount));
    const onFrame = vi.fn();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: slots(null),
      rules: RULES,
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      gamepad: { poll },
      onFrame,
    });
    runner.advance(2);
    runner.dispose();
    runner.advance(5);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(runner.frame).toBe(2);
  });

  it("cancels its animation frame, and neither a queued frame nor a restart runs", () => {
    const queued: FrameRequestCallback[] = [];
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queued.push(cb));
    vi.stubGlobal("cancelAnimationFrame", cancel);
    try {
      const onFrame = vi.fn();
      const runner = createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players: slots(null),
        rules: RULES,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        onFrame,
      });
      const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
      runner.start(canvas);
      runner.dispose();
      expect(cancel).toHaveBeenCalledWith(1);
      // A callback the browser had already queued finds nothing to do.
      queued[0](performance.now() + 1000);
      runner.start(canvas);
      expect(queued).toHaveLength(1);
      expect(onFrame).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
