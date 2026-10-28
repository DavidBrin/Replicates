/**
 * The loop that turns the pure simulation into a game you can play.
 *
 * Everything below this file is deterministic and knows nothing about time,
 * canvases or keyboards; everything above it is presentation. This is the seam,
 * and it has exactly three jobs: decide *when* a frame happens, decide *what
 * inputs* that frame sees, and hand the result to the renderer.
 *
 * ## Why a fixed timestep, and not just `requestAnimationFrame`
 *
 * Every duration in Ultimate is a frame count — 3 frames of jumpsquat, 5 frames
 * of perfect-shield window, 9 frames of buffer. If the simulation advanced by
 * whatever `requestAnimationFrame` happened to deliver, a 144Hz monitor would
 * run the whole game at 2.4× the intended speed and a stutter would change a
 * fighter's frame data mid-match. So the simulation is pinned to 60Hz and the
 * display rate is allowed to be whatever it is: accumulate real elapsed time,
 * run as many whole 60Hz ticks as fit, and interpolate the *render* across the
 * remainder. A 144Hz display gets smooth motion out of a 60Hz simulation
 * without the simulation ever learning that 144Hz exists.
 *
 * This is also the precondition for netplay. Two peers agree on a frame number,
 * not on a wall clock — which only works if a frame is the same amount of game
 * on both machines.
 */

import type {
  FighterDef,
  FighterState,
  GameState,
  InputFrame,
  MatchOutcome,
  MatchRules,
  StageDef,
  StepEvents,
} from "@/engine/types";
import { createInitialState, cloneState, step, DEFAULT_SEED } from "@/engine/simulate";
import type { FighterSelection } from "@/engine/simulate";
import { createCamera, updateCamera, type Camera } from "@/render/camera";
import { createVfx, stepVfx, type VfxState } from "@/render/vfx";
import { createHudState, updateHud, type HudState } from "@/render/hud";
import { render } from "@/render/renderer";
import { cpuInput, type CpuWorld } from "@/ai/cpu";
import { airBrakeFromDef, meleeReachFromDef, stageViewFromDef } from "@/ai/behaviours";
import type { KeyboardInput } from "@/input/keyboard";
import { mergeKeyboardAndPad, type GamepadInput } from "@/input/gamepad";
import { RollbackSession, type DesyncReport, type NetStats } from "@/net/rollback";
import type { Transport } from "@/net/transport";
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";
import { GAME_SIM_CONTEXT } from "./simContext";

/** 60Hz, expressed once. */
export const FRAME_MS = 1000 / 60;

/**
 * The most simulation one animation frame may run.
 *
 * Without this, a tab that was backgrounded for thirty seconds returns with
 * 1,800 frames owed, tries to run them all before painting, blocks the main
 * thread for seconds, and accumulates more debt while it does — the "spiral of
 * death". Five frames is enough to absorb ordinary jitter and small enough that
 * a long stall is simply forgiven rather than replayed.
 */
export const MAX_CATCHUP_FRAMES = 5;

/**
 * How often a lingering online runner re-sends the inputs the other machine
 * has not acknowledged (see `NetplayOptions.lingerMs`). A few times a round
 * trip, so a lossy link still gets them through quickly, at a fraction of the
 * rate play sends at.
 */
export const LINGER_RESEND_MS = 50;

export interface PlayerSlot {
  readonly selection: FighterSelection;
  /** CPU level 1-9, or `null` for a human on the keyboard. */
  readonly cpuLevel: number | null;
  readonly label?: string;
}

/**
 * As much of the audio engine as the loop needs.
 *
 * Structural rather than the concrete `AudioEngine`, for the same reason
 * `getFighter` is injected: this module is the seam, and a seam that imports
 * Web Audio drags a browser API into every test that wants to run a match.
 * `AudioEngine` satisfies this without being told about it.
 */
export interface MatchAudio {
  handleEvents(events: StepEvents): void;
  setShieldHeld(port: number, held: boolean): void;
}

/**
 * The shield is up — including `shieldRelease`, whose bubble is still shrinking
 * on screen. Kept identical to `drawShield`'s predicate on purpose: a hum that
 * stops while a bubble is still visible is a bug you hear before you see.
 */
function isShielding(f: FighterState): boolean {
  return (
    f.action === "shieldStart" ||
    f.action === "shield" ||
    f.action === "shieldStun" ||
    f.action === "shieldRelease"
  );
}

/**
 * An online match. The runner hands its inputs to a `RollbackSession` instead
 * of stepping the engine itself; the session predicts the remote port, rolls
 * back when the real input lands, and stalls rather than guess past its cap.
 */
export interface NetplayOptions {
  readonly transport: Transport;
  /** The ports this machine supplies. Online v1: exactly one. */
  readonly localPorts: readonly number[];
  readonly inputDelay?: number;
  /** On by default; tests turn it off so both peers schedule identically. */
  readonly autoInputDelay?: boolean;
  /** RTT clock, for tests. Never reaches the simulation. */
  readonly now?: () => number;
  readonly onDesync?: (report: DesyncReport) => void;
  /**
   * How long `dispose()` keeps sending the inputs the other machine has not
   * acknowledged, once the match has ended here. It may still be short of the
   * ones that confirm the same result, and with nothing ticking here nothing
   * else would send them. 0, the default: not at all.
   */
  readonly lingerMs?: number;
  /**
   * Whether the transport can still deliver. A linger ends as soon as it says
   * no: the peer has gone, or this side has left the room. Absent, the linger
   * runs its full length.
   */
  readonly isOpen?: () => boolean;
}

export interface MatchRunnerOptions {
  readonly stage: StageDef;
  readonly players: readonly PlayerSlot[];
  readonly rules: MatchRules;
  readonly seed?: number;
  /** Resolves a fighter definition. Injected so this module never imports the roster. */
  readonly getFighter: (id: string) => FighterDef;
  /** Absent in a CPU-only demo match. */
  readonly keyboard?: KeyboardInput | null;
  /**
   * Pads, polled once per tick and merged with the keyboard per port. The
   * caller attaches and detaches them; the runner only polls.
   */
  readonly gamepad?: Pick<GamepadInput, "poll"> | null;
  /** Present for an online match. */
  readonly net?: NetplayOptions | null;
  /** Absent under test, and until the player's first gesture unlocks the context. */
  readonly audio?: MatchAudio | null;
  readonly onEnd?: (outcome: MatchOutcome) => void;
  readonly onFrame?: (state: GameState, events: StepEvents) => void;
  readonly debugSilhouette?: boolean;
}

export interface MatchRunner {
  /** Begin painting to `canvas` and stepping the simulation. */
  start(canvas: HTMLCanvasElement): void;
  stop(): void;
  /** Advance exactly `n` frames with no wall clock involved. For tests and e2e. */
  advance(n: number): void;
  readonly state: GameState;
  readonly frame: number;
  /**
   * The cosmetic state, exposed so a test can assert it is being *aged*.
   *
   * Not decoration: the one bug this seam has shipped twice is forgetting to
   * drive a collaborator every frame, and a collaborator you cannot observe is
   * one you cannot hold to that.
   */
  readonly vfx: VfxState;
  /**
   * Where the view currently is, so a capture can frame what it photographed.
   *
   * A contact sheet that crops the middle of the screen crops the middle of the
   * *stage*, and a fighter who spawns near an edge lands on the crop boundary
   * sixty pixels tall — which is how a whole character's moveset came to be
   * reviewed from thumbnails. Mutated in place every tick, so read it live.
   */
  readonly camera: Camera;
  /** Repaint without stepping — used when the match has ended but stays on screen. */
  redraw(): void;
  /**
   * Stop, and release the rollback session's hold on the transport. Final:
   * afterwards nothing ticks, polls, paints or reports, and `start` does nothing.
   * An online match that has ended, or found a desync, lets go only after its
   * linger (`NetplayOptions.lingerMs`), re-sending its unacknowledged inputs
   * (and the desync's hash) until then.
   */
  dispose(): void;
  /** Rollback counters for the HUD; null in a local match. */
  readonly netStats: NetStats | null;
  /** The last tick was refused by the rollback session — waiting on the peer. */
  readonly stalled: boolean;
}

export function createMatchRunner(options: MatchRunnerOptions): MatchRunner {
  const {
    stage,
    players,
    rules,
    seed = DEFAULT_SEED,
    getFighter,
    keyboard = null,
    gamepad = null,
    net = null,
    audio = null,
    onEnd,
    onFrame,
    debugSilhouette = false,
  } = options;

  const defs = players.map((p) => getFighter(p.selection.defId));

  let state = createInitialState(
    stage.id,
    players.map((p) => p.selection),
    rules,
    seed,
  );
  let previous: GameState | null = null;
  let events: StepEvents | null = null;

  // `step` needs the previous frame's inputs to tell a press from a hold. A
  // button is an edge, and `GameState` deliberately has no field for one.
  let prevInputs: InputFrame[] = players.map(() => 0);

  // Online, the session owns stepping: it saves, predicts, rolls back and
  // replays, and the runner only feeds it local input and draws what it says.
  const session = net
    ? new RollbackSession({
        transport: net.transport,
        deps: ENGINE_ROLLBACK_DEPS,
        initialState: state,
        playerCount: players.length,
        localPorts: net.localPorts,
        inputDelay: net.inputDelay,
        autoInputDelay: net.autoInputDelay,
        now: net.now,
        onDesync: (report) => {
          // A desync before the result ends the match here, and the linger
          // re-sends this frame's hash so the other machine finds it too. One
          // after the result changes nothing: that result was final.
          if (!ended && desyncFrame === null) desyncFrame = report.frame;
          net.onDesync?.(report);
        },
      })
    : null;
  let stalled = false;
  const lingerMs = net?.lingerMs ?? 0;

  // The CPU's randomness has to live somewhere that rolls back with the match.
  // Until a rollback session owns it, it lives here, and every `cpuInput` result
  // writes its seed back — a CPU whose seed is dropped re-rolls the same
  // decision forever and stops looking like a player.
  let cpuSeed = seed ^ 0x1f2e3d4c;

  const cpuWorlds: CpuWorld[] = players.map((p, i) => ({
    stage: stageViewFromDef(stage),
    jumps: defs[i]?.attributes.jumps ?? 2,
    // Per fighter, from its own move data. A shared constant here is what let a
    // CPU decide it was close enough to punch from further than its arm goes.
    meleeReach: defs[i] ? meleeReachFromDef(defs[i]) : undefined,
    airBrake: defs[i] ? airBrakeFromDef(defs[i]) : undefined,
  }));

  const camera = createCamera(stage);
  const vfx: VfxState = createVfx();
  const hud: HudState = createHudState();

  let ctx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let running = false;
  let lastTime = 0;
  let accumulator = 0;
  let ended = false;
  let disposed = false;
  /** The frame a desync was found on before the match ended, if one was. */
  let desyncFrame: number | null = null;

  // Key presses from ticks the rollback session refused. A refused tick's input
  // is never scheduled, and a key tapped between two ticks is in exactly one
  // drain, so without this the tap would be gone; it rides on the next tick.
  const noPresses: readonly InputFrame[] = players.map(() => 0);
  let carriedPresses = noPresses;
  // This tick's presses plus the carried ones, kept in case it is refused too.
  let tickPresses = noPresses;

  function gatherInputs(): InputFrame[] {
    const drained = keyboard ? keyboard.drain() : null;
    // Exactly once per tick: a pad's press edges are the diff against the last poll.
    const pads = gamepad ? gamepad.poll(players.length) : null;
    tickPresses = players.map((_, port) => carriedPresses[port] | (drained?.pressed[port] ?? 0));
    return players.map((p, port) => {
      if (p.cpuLevel === null) {
        const keys = (drained?.frames[port] ?? 0) | carriedPresses[port];
        return mergeKeyboardAndPad(keys, pads?.frames[port] ?? 0);
      }
      const r = cpuInput(state, port, p.cpuLevel, cpuSeed, cpuWorlds[port]);
      cpuSeed = r.seed;
      return r.input;
    });
  }

  /**
   * The result the match has really reached, or null.
   *
   * Online, the state on screen may stand on guessed input, and so may its
   * outcome: the KO can be undone or moved, and the clock can run out a frame
   * later, once the real input lands. Only the state every input of which is
   * confirmed is final, so its outcome, and nothing on screen, ends the match.
   *
   * Asking "is the frame just run confirmed" instead never passes on the peer
   * running ahead, which under steady latency is a frame or more past
   * confirmation on every tick: its match never ends, and the other machine
   * leaving reads as a lost connection.
   */
  function finalOutcome(): MatchOutcome | null {
    if (session === null) return state.outcome;
    return session.confirmedState()?.outcome ?? null;
  }

  function tick(): void {
    // A disposed runner reads no input and reports nothing: an `advance` from a
    // test or a stray caller must not poll a pad or end a match after teardown.
    if (disposed) return;
    const inputs = gatherInputs();
    if (session) {
      const result = session.advance(inputs);
      stalled = !result.advanced;
      if (!result.advanced) {
        // A refused frame ran nothing new: nothing to age, sound or report. The
        // picture holds still instead of re-blending the last step, and this
        // tick's presses wait for the next one.
        previous = state;
        carriedPresses = tickPresses;
        return;
      }
      carriedPresses = noPresses;
      previous = state;
      state = result.state;
      events = result.events;
    } else {
      previous = state;
      const result = step(state, inputs, { prevInputs, ctx: GAME_SIM_CONTEXT });
      state = result.state;
      events = result.events;
      prevInputs = inputs;
    }

    // `stepVfx`, not `ingestEvents`. Ingestion only *creates* — the sparks, the
    // KO flash, the white tint on a fighter who was just hit. Ageing them is a
    // separate call, and driving the first without the second means nothing on
    // screen ever expires: sparks pile up to the particle cap and stay, a hit
    // fighter stays white, and the full-screen flash a lost stock puts up never
    // lifts. `stepVfx` is the composite that runs both in the right order, plus
    // the three trackers that read cosmetic state off the fighters directly
    // (dodge afterimages, charge motes, damage smoke) and which nothing else
    // calls at all.
    stepVfx(vfx, events, state, defs);
    updateHud(hud, state);
    updateCamera(camera, state, stage, events);

    // Sound is driven from the same events the particles are, on the same
    // frame, so a hit spark and its impact never drift apart. `setShieldHeld`
    // is level-triggered and idempotent by design, so calling it every frame
    // for every fighter is the intended usage rather than a waste.
    if (audio) {
      audio.handleEvents(events);
      for (const f of state.fighters) audio.setShieldHeld(f.port, isShielding(f));
    }

    onFrame?.(state, events);

    const outcome = ended ? null : finalOutcome();
    if (outcome) {
      ended = true;
      onEnd?.(outcome);
    }
  }

  function paint(alpha: number): void {
    if (!ctx) return;
    render(
      ctx,
      {
        current: state,
        previous,
        stage,
        fighters: defs,
        labels: players.map((p, i) => p.label ?? defs[i]?.name ?? ""),
        cpu: players.map((p) => p.cpuLevel !== null),
        vfx,
        hud,
        debugSilhouette,
      },
      events,
      camera,
      alpha,
    );
  }

  function loop(now: number): void {
    if (!running) return;
    raf = requestAnimationFrame(loop);

    const elapsed = now - lastTime;
    lastTime = now;
    // Clamping the *input* to the accumulator rather than the tick count means a
    // stall is forgiven rather than deferred: the game resumes where it is, not
    // where it would have been.
    accumulator += Math.min(elapsed, FRAME_MS * MAX_CATCHUP_FRAMES);

    let ran = 0;
    while (accumulator >= FRAME_MS && ran < MAX_CATCHUP_FRAMES) {
      tick();
      accumulator -= FRAME_MS;
      ran++;
    }

    paint(accumulator / FRAME_MS);
  }

  /**
   * The match is over here, but maybe not there: the other machine can still
   * be short of the inputs that end it on its side, however many a burst of
   * loss took, and with nothing ticking here nothing else would send them. So
   * every input it has not acknowledged goes out again on a timer until the
   * linger is up or the transport can no longer deliver, and only then does
   * the session let go. The simulation stays where it ended. A match stopped
   * by a desync lingers the same way, and re-sends the hash that showed it:
   * that packet is the other machine's only way to find the same mismatch.
   */
  function linger(live: RollbackSession, ms: number, hashFrame: number | null): void {
    const isOpen = net?.isOpen ?? (() => true);
    if (!isOpen()) {
      live.close();
      return;
    }
    // After a desync, the hash that shows it goes out again with the inputs.
    const resend = () => {
      live.resendInputs();
      if (hashFrame !== null) live.resendHash(hashFrame);
    };
    resend();
    const timer = setInterval(() => {
      if (isOpen()) resend();
      else finish();
    }, LINGER_RESEND_MS);
    const deadline = setTimeout(finish, ms);
    function finish(): void {
      clearInterval(timer);
      clearTimeout(deadline);
      live.close();
    }
  }

  return {
    start(canvas: HTMLCanvasElement) {
      if (disposed) return;
      ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      running = true;
      lastTime = performance.now();
      accumulator = 0;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    advance(n: number) {
      for (let i = 0; i < n; i++) tick();
      paint(0);
    },
    redraw() {
      paint(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ctx = null;
      if (session && (ended || desyncFrame !== null) && lingerMs > 0) linger(session, lingerMs, desyncFrame);
      else session?.close();
    },
    get netStats() {
      return session ? session.stats() : null;
    },
    get stalled() {
      return stalled;
    },
    get state() {
      return state;
    },
    get frame() {
      return state.frame;
    },
    get vfx() {
      return vfx;
    },
    /**
     * Where the view currently is, so a capture can frame what it photographed.
     *
     * A contact sheet that crops the middle of the screen crops the middle of
     * the *stage*, and a fighter who spawns near an edge lands on the crop
     * boundary sixty pixels tall. Read live rather than snapshotted: the camera
     * is mutated in place every tick.
     */
    get camera() {
      return camera;
    },
  };
}

/** A snapshot helper for tests that want to compare two runs. */
export function snapshot(state: GameState): GameState {
  return cloneState(state);
}
