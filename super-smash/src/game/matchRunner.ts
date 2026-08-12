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
  GameState,
  InputFrame,
  MatchOutcome,
  MatchRules,
  StageDef,
  StepEvents,
} from "@/engine/types";
import { createInitialState, cloneState, step, DEFAULT_SEED } from "@/engine/simulate";
import type { FighterSelection } from "@/engine/simulate";
import { createCamera, updateCamera } from "@/render/camera";
import { createVfx, ingestEvents, type VfxState } from "@/render/vfx";
import { createHudState, updateHud, type HudState } from "@/render/hud";
import { render } from "@/render/renderer";
import { cpuInput, type CpuWorld } from "@/ai/cpu";
import { stageViewFromDef } from "@/ai/behaviours";
import type { KeyboardInput } from "@/input/keyboard";

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

export interface PlayerSlot {
  readonly selection: FighterSelection;
  /** CPU level 1-9, or `null` for a human on the keyboard. */
  readonly cpuLevel: number | null;
  readonly label?: string;
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
  /** Repaint without stepping — used when the match has ended but stays on screen. */
  redraw(): void;
}

export function createMatchRunner(options: MatchRunnerOptions): MatchRunner {
  const {
    stage,
    players,
    rules,
    seed = DEFAULT_SEED,
    getFighter,
    keyboard = null,
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

  // The CPU's randomness has to live somewhere that rolls back with the match.
  // Until a rollback session owns it, it lives here, and every `cpuInput` result
  // writes its seed back — a CPU whose seed is dropped re-rolls the same
  // decision forever and stops looking like a player.
  let cpuSeed = seed ^ 0x1f2e3d4c;

  const cpuWorlds: CpuWorld[] = players.map((p, i) => ({
    stage: stageViewFromDef(stage),
    jumps: defs[i]?.attributes.jumps ?? 2,
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

  function gatherInputs(): InputFrame[] {
    const drained = keyboard ? keyboard.drain() : null;
    return players.map((p, port) => {
      if (p.cpuLevel === null) return drained?.frames[port] ?? 0;
      const r = cpuInput(state, port, p.cpuLevel, cpuSeed, cpuWorlds[port]);
      cpuSeed = r.seed;
      return r.input;
    });
  }

  function tick(): void {
    const inputs = gatherInputs();
    previous = state;
    const result = step(state, inputs, { prevInputs });
    state = result.state;
    events = result.events;
    prevInputs = inputs;

    ingestEvents(vfx, events, state);
    updateHud(hud, state);
    updateCamera(camera, state, stage, events);

    onFrame?.(state, events);

    if (state.outcome && !ended) {
      ended = true;
      onEnd?.(state.outcome);
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

  return {
    start(canvas: HTMLCanvasElement) {
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
    get state() {
      return state;
    },
    get frame() {
      return state.frame;
    },
  };
}

/** A snapshot helper for tests that want to compare two runs. */
export function snapshot(state: GameState): GameState {
  return cloneState(state);
}
