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

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRAME_MS,
  LINGER_RESEND_MS,
  createMatchRunner,
  type MatchAudio,
  type MatchRunner,
  type NetplayOptions,
  type PlayerSlot,
} from "./matchRunner";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
import { GAME_SIM_CONTEXT } from "./simContext";
import { meleeReachFromDef } from "@/ai/behaviours";
import { hashState } from "@/engine/hash";
import { KO_FREEZE_FRAMES } from "@/engine/simulate";
import { Btn, type InputFrame, type MatchOutcome, type MatchRules } from "@/engine/types";
import { KeyboardInput } from "@/input/keyboard";
import { CONFIG_ARROWS } from "@/input/schemes";
import { LoopbackNetwork } from "@/net/adapters/loopback";
import { PacketType, decodePacket, type InputPacket } from "@/net/packet";
import { MAX_PREDICTION_FRAMES } from "@/net/rollback";
import { ROLE_PORT } from "@/net/signalProtocol";
import { createNullTransport, type Transport } from "@/net/transport";
import { render } from "@/render/renderer";

// Nothing in these tests paints a real canvas; the stub lets one test see what
// the runner would have drawn.
vi.mock("@/render/renderer", () => ({ render: vi.fn() }));

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

describe("a local match", () => {
  /** The same context online play steps with (rollbackDeps), so a bone bake reaches both. */
  it("steps with the game's SimContext", () => {
    const runner = idleRunner();
    const fighter = vi.spyOn(GAME_SIM_CONTEXT, "fighter");
    try {
      runner.advance(1);
      expect(fighter).toHaveBeenCalled();
    } finally {
      fighter.mockRestore();
    }
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

/** Mario against Donkey Kong, both human. */
const HUMANS: PlayerSlot[] = [
  { selection: { defId: "mario" }, cpuLevel: null, label: "P1" },
  { selection: { defId: "donkeyKong" }, cpuLevel: null, label: "P2" },
];

/** A pad that drives `port` only, with whatever `read` says this tick. */
function padOn(port: number, read: () => InputFrame) {
  return {
    poll(portCount = 4) {
      const frames = new Array<InputFrame>(portCount).fill(0);
      frames[port] = read();
      const none = new Array<InputFrame>(portCount).fill(0);
      return { frames, pressed: none, released: none, sticks: [], connectedPads: [0] };
    },
  };
}

describe("an online match ends once, on both machines", () => {
  /**
   * What a player presses on frame `f`: a seeded stream that changes every
   * `period` frames. Walking at the opponent, attacks, specials, jumps, shields
   * and grabs, so the other side's guesses keep going wrong right up to the
   * end, and fighters fall off the stage often enough to lose their last stock.
   */
  function scripted(port: number, f: number, seed: number, period: number): InputFrame {
    if (f < 0) return 0;
    const k = Math.floor(f / period);
    let h = (Math.imul(k + 1, 2654435761) ^ Math.imul(port + 3, 97) ^ Math.imul(seed + 11, 7919)) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h ^= h >>> 15;
    const toward = port === 0 ? Btn.Right : Btn.Left;
    const choices = [
      toward, toward, toward | Btn.Attack, Btn.Attack, Btn.Special, toward | Btn.Special, Btn.Jump,
      0, Btn.Shield, toward, Btn.Attack | Btn.Up, Btn.Grab, toward | Btn.Attack,
    ];
    return choices[h % choices.length];
  }

  interface Link {
    readonly latencyMs: number;
    readonly jitterMs: number;
    /** Seeds both the script and the network's jitter. */
    readonly seed: number;
    readonly period: number;
    /**
     * Frames of wall time, from frame `at`, in which every packet one side
     * sends (or both sides) is lost: the shape of a Wi-Fi dropout.
     */
    readonly burst?: { readonly at: number; readonly frames: number; readonly from: "host" | "guest" | "both" };
  }

  // Fixed, so one machine can say what the result should be: a retuned delay
  // moves inputs to other frames, and the match itself changes with them.
  const INPUT_DELAY = 2;
  const TIMED: MatchRules = { ...RULES, mode: "time", timeLimit: 180 };
  const LAST_STOCK: MatchRules = { ...RULES, mode: "stock", stocks: 1 };

  const TIMED_SWEEP = { latencies: [33, 50, 80, 120], seeds: [1, 2, 3, 4], periods: [1, 2, 4, 8] };
  // [seed, period] pairs whose scripts lose a last stock within a few hundred
  // frames on one machine; most scripts do, these are the quick ones.
  const STOCK_SWEEP = {
    latencies: [33, 80, 120],
    scripts: [[1, 4], [1, 5], [2, 8], [4, 4], [4, 5], [4, 8], [7, 5], [7, 8], [8, 5], [8, 8]] as const,
  };

  /** One machine, no network, the same inputs on the same frames. */
  function oneMachine(rules: MatchRules, link: Link, budget: number): MatchOutcome | null {
    const runner: MatchRunner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
      rules,
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      gamepad: {
        poll(portCount = 4) {
          const f = runner.frame - INPUT_DELAY;
          const frames = new Array<InputFrame>(portCount).fill(0);
          frames[0] = scripted(0, f, link.seed, link.period);
          frames[1] = scripted(1, f, link.seed, link.period);
          const none = new Array<InputFrame>(portCount).fill(0);
          return { frames, pressed: none, released: none, sticks: [], connectedPads: [0, 1] };
        },
      },
    });
    for (let i = 0; i < budget && !runner.state.outcome; i++) runner.advance(1);
    return runner.state.outcome;
  }

  /**
   * Host and guest, half a frame out of phase as two real machines are. A
   * side that reports a result leaves on the spot, disposed and disconnected
   * as the results screen takes a player out of the room, so the other side
   * has to finish on what it had already been sent. Returns every outcome
   * each side reported.
   */
  function playOut(rules: MatchRules, link: Link, budget: number): [MatchOutcome[], MatchOutcome[]] {
    const network = new LoopbackNetwork({ latencyMs: link.latencyMs, jitterMs: link.jitterMs, seed: link.seed });
    const ends: [MatchOutcome[], MatchOutcome[]] = [[], []];
    const roles = ["host", "guest"] as const;
    let wallFrame = 0;
    const burst = link.burst;
    const lost = (role: (typeof roles)[number]) =>
      burst !== undefined &&
      (burst.from === role || burst.from === "both") &&
      wallFrame >= burst.at &&
      wallFrame < burst.at + burst.frames;
    const peers = roles.map((role) => {
      const port = ROLE_PORT[role];
      const transport = network.connect(role);
      const runner: MatchRunner = createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players: HUMANS,
        rules,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        gamepad: padOn(port, () => scripted(port, runner.frame, link.seed, link.period)),
        net: {
          transport: { ...transport, send: (bytes) => (lost(role) ? undefined : transport.send(bytes)) },
          localPorts: [port],
          inputDelay: INPUT_DELAY,
          autoInputDelay: false,
          now: () => network.now(),
        },
        onEnd: (outcome) => ends[port].push(outcome),
      });
      return runner;
    });
    const gone = [false, false];
    for (let i = 0; i < budget && !(gone[0] && gone[1]); i++) {
      wallFrame = i;
      for (const role of roles) {
        const port = ROLE_PORT[role];
        if (!gone[port]) {
          peers[port].advance(1);
          if (ends[port].length > 0) {
            gone[port] = true;
            peers[port].dispose();
            network.disconnect(role);
          }
        }
        network.advance(FRAME_MS / 2);
      }
    }
    return ends;
  }

  /** Empty when both sides reported once, the same result one machine reaches. */
  function problems(rules: MatchRules, link: Link, budget: number): string[] {
    const truth = oneMachine(rules, link, budget);
    const [host, guest] = playOut(rules, link, budget);
    const burst = link.burst ? `, ${link.burst.frames}-frame burst from ${link.burst.from}` : "";
    const name = `${rules.mode} ${link.latencyMs}±${link.jitterMs} ms, seed ${link.seed}, period ${link.period}${burst}`;
    if (truth === null) return [`${name}: one machine never finished; pick another script`];
    const found: string[] = [];
    for (const [side, ends] of [["host", host], ["guest", guest]] as const) {
      if (ends.length !== 1) found.push(`${name}: ${side} reported ${ends.length} results`);
      else if (JSON.stringify(ends[0]) !== JSON.stringify(truth)) {
        found.push(`${name}: ${side} reported ${JSON.stringify(ends[0])}, one machine ${JSON.stringify(truth)}`);
      }
    }
    return found;
  }

  it("finishes on both sides over the link that once stranded the guest", () => {
    // The host saw time run out on a frame it had confirmed and left; the
    // guest stalled at the prediction cap with the result still unreported.
    expect(problems(TIMED, { latencyMs: 80, jitterMs: 0, seed: 1, period: 4 }, 900)).toEqual([]);
  });

  it("finishes a timed match on both sides, on one machine's result, across a sweep of links", () => {
    const found: string[] = [];
    for (const latencyMs of TIMED_SWEEP.latencies) {
      for (const jitterMs of [0, 15]) {
        for (const seed of TIMED_SWEEP.seeds) {
          for (const period of TIMED_SWEEP.periods) {
            found.push(...problems(TIMED, { latencyMs, jitterMs, seed, period }, 900));
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("finishes on a last-stock KO on both sides, on one machine's result, across a sweep of links", () => {
    const found: string[] = [];
    for (const latencyMs of STOCK_SWEEP.latencies) {
      for (const [seed, period] of STOCK_SWEEP.scripts) {
        found.push(...problems(LAST_STOCK, { latencyMs, jitterMs: 0, seed, period }, 1200));
      }
    }
    expect(found).toEqual([]);
  });

  it("finishes on both sides, on one machine's result, through a burst of one-way loss", () => {
    // Longer than any fixed window of redundancy: each side resends what the
    // other has not acknowledged, so the match picks up where the link
    // dropped instead of freezing on both machines.
    const found: string[] = [];
    for (const from of ["host", "guest", "both"] as const) {
      for (const frames of [10, 20, 60, 120]) {
        found.push(...problems(TIMED, { latencyMs: 50, jitterMs: 0, seed: 2, period: 4, burst: { at: 60, frames, from } }, 900));
      }
    }
    expect(found).toEqual([]);
  });

  it("confirms a frame on every tick through a KO's freeze, which the link monitor's stall check relies on", () => {
    // linkMonitor.ts calls a match lost when its confirmed frame stands still
    // for ten seconds. A KO freezes the picture, not the frame count: the
    // simulation still steps, so the session still confirms, every tick.
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const rules: MatchRules = { ...RULES, mode: "stock", stocks: 2 };
    const [host, guest] = ([0, 1] as const).map((port) => {
      const runner: MatchRunner = createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players: HUMANS,
        rules,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        // A script that loses a stock within a few hundred frames.
        gamepad: padOn(port, () => scripted(port, runner.frame, 1, 4)),
        net: { transport: network.connect(`p${port}`), localPorts: [port], inputDelay: INPUT_DELAY, autoInputDelay: false, now: () => network.now() },
      });
      return runner;
    });
    network.advance(0);
    let confirmed = host.netStats?.confirmedFrame ?? -1;
    let frozenTicks = 0;
    const stood: number[] = [];
    for (let i = 0; i < 1200 && frozenTicks < KO_FREEZE_FRAMES; i++) {
      host.advance(1);
      guest.advance(1);
      network.advance(FRAME_MS);
      const latest = host.netStats?.confirmedFrame ?? -1;
      if (host.state.freezeFrames > 0) frozenTicks++;
      if (latest <= confirmed) stood.push(host.frame);
      confirmed = latest;
    }
    expect(frozenTicks).toBe(KO_FREEZE_FRAMES);
    expect(stood).toEqual([]);
  });

  it("reports a result once, however long the match stays on screen", () => {
    const onEnd = vi.fn();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
      rules: { ...RULES, mode: "time", timeLimit: 3 },
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      onEnd,
    });
    runner.advance(30);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(runner.state.outcome);
  });

  it("does not end on an outcome it has only predicted", () => {
    const onEnd = vi.fn();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
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

describe("a tick the rollback session refuses", () => {
  const INPUT_DELAY_FOR_STALLS = 2;

  /** Host and guest with the host's keyboard; the guest is ticked by hand. */
  function hostWithKeyboard() {
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const keyboard = new KeyboardInput([{ port: 0, scheme: CONFIG_ARROWS }], { window, overlayHost: null });
    keyboard.attach();
    const sent: InputFrame[] = [];
    const transport = network.connect("host");
    const host = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
      rules: RULES,
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      keyboard,
      net: {
        // Everything the host puts on the wire for its own port, in order.
        transport: {
          ...transport,
          send(bytes) {
            const packet = decodePacket(bytes);
            if (packet?.type === PacketType.Input) {
              packet.inputs.forEach((input, i) => (sent[packet.startFrame + i] = input));
            }
            transport.send(bytes);
          },
        },
        localPorts: [0],
        inputDelay: INPUT_DELAY_FOR_STALLS,
        autoInputDelay: false,
        now: () => network.now(),
      },
    });
    const guest = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
      rules: RULES,
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      net: { transport: network.connect("guest"), localPorts: [1], now: () => network.now() },
    });
    return { network, keyboard, host, guest, sent };
  }


  it("keeps a key tapped during the stall for the next frame that runs", () => {
    const { network, keyboard, host, guest, sent } = hostWithKeyboard();
    try {
      // The guest says nothing, so the host runs to the prediction cap and stops.
      for (let i = 0; i < 20; i++) {
        host.advance(1);
        network.advance(FRAME_MS);
      }
      expect(host.stalled).toBe(true);
      const stalledAt = host.frame;

      // A tap, down and up between two ticks, while the host is refusing frames.
      window.dispatchEvent(new KeyboardEvent("keydown", { code: CONFIG_ARROWS.bindings.jump }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: CONFIG_ARROWS.bindings.jump }));
      host.advance(1);
      expect(host.stalled).toBe(true);

      // The guest catches up; the host's next frame runs, with the tap in it.
      for (let i = 0; i < 30; i++) {
        guest.advance(1);
        host.advance(1);
        network.advance(FRAME_MS);
      }
      expect(host.frame).toBeGreaterThan(stalledAt);
      expect(sent[stalledAt + INPUT_DELAY_FOR_STALLS] ?? 0).toBe(Btn.Jump);
      expect(sent.filter((input) => input & Btn.Jump)).toHaveLength(1);
    } finally {
      keyboard.detach();
    }
  });

  it("holds the picture still instead of re-blending the last step", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    try {
      const runner = createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players: HUMANS,
        rules: RULES,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        net: { transport: createNullTransport("alone"), localPorts: [0] },
      });
      runner.start({ getContext: () => ({}) } as unknown as HTMLCanvasElement);
      // To the prediction cap, then refused: the last ticks ran nothing.
      runner.advance(20);
      expect(runner.stalled).toBe(true);
      const drawn = vi.mocked(render).mock.lastCall?.[1];
      expect(drawn?.previous).toBe(drawn?.current);
      runner.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("dispose is final", () => {
  it("polls nothing and reports nothing afterwards", () => {
    const pad = fakePad(() => Btn.Right);
    const poll = vi.fn((portCount?: number) => pad.poll(portCount));
    const onFrame = vi.fn();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
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
        players: HUMANS,
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

describe("an online match that ended here lingers after dispose", () => {
  const LINGER_MS = 1_500;
  /** Over in three frames, so both machines confirm the result almost at once. */
  const SHORT: MatchRules = { ...RULES, mode: "time", timeLimit: 3 };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A transport that records the input packets it sends, and when its listeners are let go. */
  function watched(transport: Transport) {
    const sent: InputPacket[] = [];
    const released = vi.fn();
    const watch = (off: () => void) => () => {
      released();
      off();
    };
    const wrapped: Transport = {
      selfId: transport.selfId,
      send(bytes) {
        const packet = decodePacket(bytes);
        if (packet?.type === PacketType.Input) sent.push(packet);
        transport.send(bytes);
      },
      onMessage: (cb) => watch(transport.onMessage(cb)),
      onPeerJoin: (cb) => watch(transport.onPeerJoin(cb)),
      onPeerLeave: (cb) => watch(transport.onPeerLeave(cb)),
      close: () => transport.close(),
    };
    return { transport: wrapped, sent, released };
  }

  type Linger = Pick<NetplayOptions, "lingerMs" | "isOpen">;

  function peer(port: number, transport: Transport, rules: MatchRules, now: () => number, linger: Linger = {}) {
    const onEnd = vi.fn();
    const onFrame = vi.fn();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
      rules,
      seed: 0x5eed1e55,
      getFighter: getFighterOrThrow,
      net: { transport, localPorts: [port], inputDelay: 2, autoInputDelay: false, now, ...linger },
      onEnd,
      onFrame,
    });
    return { runner, onEnd, onFrame };
  }

  /** Host and guest over a clean link, played until both have their result. The host's link is watched. */
  function endedPair(linger: Linger) {
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const link = watched(network.connect("host"));
    const host = peer(0, link.transport, SHORT, () => network.now(), linger);
    const guest = peer(1, network.connect("guest"), SHORT, () => network.now());
    network.advance(0);
    for (let i = 0; i < 120 && !(host.onEnd.mock.calls.length > 0 && guest.onEnd.mock.calls.length > 0); i++) {
      host.runner.advance(1);
      guest.runner.advance(1);
      network.advance(FRAME_MS);
    }
    expect(host.onEnd).toHaveBeenCalledTimes(1);
    expect(guest.onEnd).toHaveBeenCalledTimes(1);
    return { host, ...link };
  }

  it("keeps re-sending its unacknowledged inputs on a timer, without running, until the linger is up", () => {
    const { host, sent, released } = endedPair({ lingerMs: LINGER_MS });
    const last = sent.at(-1);
    const frame = host.runner.frame;
    const frames = host.onFrame.mock.calls.length;
    sent.length = 0;

    host.runner.dispose();
    vi.advanceTimersByTime(LINGER_MS - 1);
    expect(sent.length).toBeGreaterThanOrEqual(Math.floor((LINGER_MS - 1) / LINGER_RESEND_MS));
    // Every resend is the same packet, from the frame the match ended on: the
    // part of the last frame's window the guest has not acknowledged since
    // (its final packet landed after that frame), through the last input.
    expect(sent).toEqual(new Array(sent.length).fill(sent[0]));
    const skipped = (sent[0]?.startFrame ?? 0) - (last?.startFrame ?? 0);
    expect(skipped).toBeGreaterThanOrEqual(0);
    expect(sent[0]).toMatchObject({ port: last?.port, senderFrame: frame, inputs: last?.inputs.slice(skipped) });
    expect(released).not.toHaveBeenCalled();
    // The match itself stays where it ended.
    expect(host.runner.frame).toBe(frame);
    expect(host.onFrame).toHaveBeenCalledTimes(frames);
    expect(host.onEnd).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(released).toHaveBeenCalledTimes(3);
    const total = sent.length;
    vi.advanceTimersByTime(10 * LINGER_MS);
    expect(sent).toHaveLength(total);
  });

  it("lingers once however many times it is disposed", () => {
    const { host, sent, released } = endedPair({ lingerMs: LINGER_MS });
    sent.length = 0;
    host.runner.dispose();
    host.runner.dispose();
    vi.advanceTimersByTime(LINGER_MS - 1);
    // One immediate resend, then one per interval: a second linger would double it.
    expect(sent).toHaveLength(1 + Math.floor((LINGER_MS - 1) / LINGER_RESEND_MS));
    vi.advanceTimersByTime(1);
    expect(released).toHaveBeenCalledTimes(3);
  });

  it("stops as soon as the transport can no longer deliver", () => {
    let open = true;
    const { host, sent, released } = endedPair({ lingerMs: LINGER_MS, isOpen: () => open });
    sent.length = 0;
    host.runner.dispose();
    vi.advanceTimersByTime(200);
    expect(sent.length).toBeGreaterThan(0);

    // The room was left: the transport is closed.
    open = false;
    vi.advanceTimersByTime(LINGER_RESEND_MS);
    expect(released).toHaveBeenCalledTimes(3);
    const total = sent.length;
    vi.advanceTimersByTime(LINGER_MS);
    expect(sent).toHaveLength(total);
  });

  it("does not linger without a linger time", () => {
    const { host, sent, released } = endedPair({});
    sent.length = 0;
    host.runner.dispose();
    expect(released).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(LINGER_MS);
    expect(sent).toEqual([]);
  });

  it("goes quiet at once when it is disposed before the match ended", () => {
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const link = watched(network.connect("host"));
    const host = peer(0, link.transport, RULES, () => network.now(), { lingerMs: LINGER_MS });
    host.runner.advance(5);
    link.sent.length = 0;
    host.runner.dispose();
    expect(link.released).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(LINGER_MS);
    expect(link.sent).toEqual([]);
  });

  /**
   * The reason for all of it. The link swallows everything the host sends
   * over its last few frames, then recovers just as the host's match ends and
   * the host stops playing. Only a resend can still carry the inputs the guest
   * needs to confirm the same result.
   */
  function guestAfterLostTail(lingerMs: number, lostTailFrames: number): { host: MatchOutcome[]; guest: MatchOutcome[] } {
    const TIMED: MatchRules = { ...RULES, mode: "time", timeLimit: 60 };
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const hostLink = network.connect("host");
    let dropping = false;
    const lossy: Transport = {
      ...hostLink,
      send: (bytes) => {
        if (!dropping) hostLink.send(bytes);
      },
    };
    const host = peer(0, lossy, TIMED, () => network.now(), { lingerMs });
    const guest = peer(1, network.connect("guest"), TIMED, () => network.now());
    network.advance(0);
    let gone = false;
    for (let i = 0; i < 600 && guest.onEnd.mock.calls.length === 0; i++) {
      if (!gone) {
        dropping = host.runner.frame >= TIMED.timeLimit - lostTailFrames;
        host.runner.advance(1);
        if (host.onEnd.mock.calls.length > 0) {
          gone = true;
          host.runner.dispose();
          dropping = false;
        }
      }
      guest.runner.advance(1);
      network.advance(FRAME_MS);
      vi.advanceTimersByTime(FRAME_MS);
    }
    return { host: host.onEnd.mock.calls.map(([o]) => o), guest: guest.onEnd.mock.calls.map(([o]) => o) };
  }

  // Long enough that the guest is missing frames it needs (2 is not); and a
  // tail longer than the ten frames packets used to carry, which only a
  // window reaching back to what the guest acknowledged can repair. Twelve is
  // the longest the host can play through: past it, the guest has stopped
  // sending (nothing of the host's to play on) before the host's result.
  it.each([6, 12])("lets the machine still playing finish after the leaver's last %i frames of packets were lost", (tail) => {
    // Without the linger the guest is stranded, which is what makes the case worth having.
    const without = guestAfterLostTail(0, tail);
    expect(without.host).toHaveLength(1);
    expect(without.guest).toEqual([]);

    const lingered = guestAfterLostTail(LINGER_MS, tail);
    expect(lingered.host).toHaveLength(1);
    expect(lingered.guest).toEqual(lingered.host);
  });
});

/**
 * Each machine finds a desync by comparing its own hash of a confirmed frame
 * with the other's. The one that finds it first stops; if its hash packet for
 * that frame was the one lost, the other could never make the comparison, and
 * would end on a lost connection instead. So the finder lingers like a match
 * that ended, re-sending its inputs and that hash.
 */
describe("a desync reaches the machine whose copy of the hash was lost", () => {
  const LINGER_MS = 1_500;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function machine(port: number, seed: number, transport: Transport, now: () => number) {
    const desyncs: number[] = [];
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: HUMANS,
      rules: RULES,
      seed,
      getFighter: getFighterOrThrow,
      net: {
        transport,
        localPorts: [port],
        inputDelay: 2,
        autoInputDelay: false,
        now,
        lingerMs: LINGER_MS,
        onDesync: (report) => desyncs.push(report.frame),
      },
    });
    return { runner, desyncs };
  }

  /**
   * Two machines whose states differ from the first frame (different seeds,
   * the shape of two builds that disagree). Every hash the host sends is
   * lost while it plays, so only the host can find the desync; it then stops
   * and is disposed, as the play page does. `resend` says whether its linger
   * may deliver anything.
   */
  function play(resend: boolean) {
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const hostLink = network.connect("host");
    let losingHashes = true;
    const lossy: Transport = {
      ...hostLink,
      send: (bytes) => {
        const hash = decodePacket(bytes)?.type === PacketType.Hash;
        if (hash && (losingHashes || !resend)) return;
        hostLink.send(bytes);
      },
    };
    const host = machine(0, 0x5eed1e55, lossy, () => network.now());
    const guest = machine(1, 0x0dd5eed, network.connect("guest"), () => network.now());
    network.advance(0);
    let hostStopped = false;
    let guestStopped = false;
    for (let i = 0; i < 600; i++) {
      if (!hostStopped) {
        host.runner.advance(1);
        if (host.desyncs.length > 0) {
          hostStopped = true;
          host.runner.dispose();
          losingHashes = false;
        }
      }
      if (!guestStopped) {
        guest.runner.advance(1);
        if (guest.desyncs.length > 0) {
          guestStopped = true;
          // The guest lingers too, re-sending its own hash back.
          guest.runner.dispose();
        }
      }
      network.advance(FRAME_MS);
      vi.advanceTimersByTime(FRAME_MS);
    }
    return { host: host.desyncs, guest: guest.desyncs };
  }

  it("has the machine that found it re-send its hash while it lingers, so the other finds the same desync", () => {
    const { host, guest } = play(true);
    expect(host).toHaveLength(1);
    expect(guest).toEqual(host);
  });

  it("never reports the same desync twice when the other machine's re-sent hash comes back", () => {
    const { host, guest } = play(true);
    expect(host).toHaveLength(1);
    expect(guest).toHaveLength(1);
  });

  it("leaves the other machine none the wiser when nothing is re-sent, which is the case worth having", () => {
    const { host, guest } = play(false);
    expect(host).toHaveLength(1);
    expect(guest).toEqual([]);
  });
});
