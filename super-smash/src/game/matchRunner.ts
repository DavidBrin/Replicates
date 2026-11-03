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
import { Btn } from "@/engine/types";
import { createInitialState, cloneState, step, DEFAULT_SEED } from "@/engine/simulate";
import type { FighterSelection } from "@/engine/simulate";
import { createCamera, updateCamera, type Camera } from "@/render/camera";
import { createVfx, stepVfx, type VfxState } from "@/render/vfx";
import { createHudState, updateHud, type HudState } from "@/render/hud";
import { render, renderBackground, sceneDrawShift, sceneShiftAt, type RenderState } from "@/render/renderer";
import type { BakeTables } from "@/engine/acmd/bakeTables";
import { cpuInput, cpuWorldFromDef, type CpuWorld } from "@/ai/cpu";
import { stageViewFromDef } from "@/ai/behaviours";
import type { KeyboardInput } from "@/input/keyboard";
import { DIRECTION_MASK, mergeKeyboardAndPad, type GamepadInput } from "@/input/gamepad";
import { RollbackSession, type DesyncReport, type NetStats } from "@/net/rollback";
import type { Transport } from "@/net/transport";
// Three-free (`render3d/anchors.ts`): the overlay's anchors cost the page no three.js.
import { drawnTop, overlayAnchor } from "@/render3d/anchors";
import { createSceneShiftEase, easeSceneShift, peekSceneShift } from "@/render/sceneShiftEase";
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
 * on screen. Kept identical to the 3D bubble's predicate on purpose
 * (`render3d/vfx3d.ts` `shieldLook`): a hum that stops while a bubble is still
 * visible is a bug you hear before you see.
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
  /**
   * The 3D world under the overlay canvas (Plan 4, `render3d/renderer3d.ts`).
   * The play page always passes one; it is optional so unit tests can run a
   * match without a GPU, and then only the overlay is drawn.
   */
  readonly presenter?: WorldPresenter | null;
  /** The stage's 2D background, under the 3D layer. Only read with a presenter. */
  readonly background?: HTMLCanvasElement | null;
}

/** What the match runner needs from the 3D presenter. Structural, so tests can fake it. */
export interface WorldPresenter {
  /**
   * Draw the world for `rs`, framed by `camera` — the very object the overlay
   * is drawn with, so the two layers line up (`render3d/camera3d.ts`).
   * `hidden[port]`: a move effect replaces that fighter this frame.
   */
  paint(rs: RenderState, camera: Camera, alpha: number, hidden: readonly boolean[]): void;
  dispose(): void;
  /** Per port, the HUD's portrait from the loaded model (Plan 6, Task 38); optional, so a test's fake need not carry it. */
  portraits?(): readonly (CanvasImageSource | null)[];
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
  /**
   * Each port's input frame as this machine gathered it on the last tick (its keys
   * and pad merged, or its CPU's), 0 before the first: for a test that must see a
   * port nobody plays give the simulation nothing at all (Plan 5 final wave, part 3).
   */
  readonly lastInputs: readonly InputFrame[];
}

/**
 * What each port's CPU knows of its own fighter, the stage and the match
 * (`cpuWorldFromDef`): the same builder the golden and the CPU sweep use, given
 * every port's definition so a parry can time a swing off its move data (Plan 5,
 * Task 18, ruling R-T18d), and the match's own fighter lookup, so a Kirby CPU
 * knows the move its Copy Ability gives it (Task 19), and the bake the match steps
 * with, the game's own unless given (installed before `/play` mounts), so a parry's
 * swing must reach the body the engine hits (Task 18, ruling R-T18j). A port with
 * no definition gets the stage's view, two jumps and the match's definitions.
 */
export function matchCpuWorlds(
  stage: StageDef,
  defs: readonly (FighterDef | undefined)[],
  getFighter?: (id: string) => FighterDef | undefined,
  bake: BakeTables | undefined = GAME_SIM_CONTEXT.bake,
  cpu: readonly boolean[] = defs.map(() => true),
): CpuWorld[] {
  const view = stageViewFromDef(stage);
  // A human's port gets the plain world: nothing reads a full one there, and its firing
  // bands cost 40-110 ms at match start (Plan 6, Task 23; Plan 5 final wave, part 5's cost).
  return defs.map((def, i) => (def !== undefined && cpu[i] !== false ? cpuWorldFromDef(def, view, defs, getFighter, bake) : { stage: view, jumps: 2, matchDefs: defs }));
}

/**
 * Presses read on a frame that never reached the wire, carried to a later one (Plan 6, Task 4):
 * their bits (`press`), and `aim`, the soft direction an Attack among them was pressed under,
 * held from before so not itself a press (fix round 2). Both keep the meaning the press had on
 * its own frame (`carryOf`, `joinCarried`).
 */
interface Carry {
  readonly press: InputFrame;
  readonly aim: InputFrame;
}

const NO_CARRY: Carry = { press: 0, aim: 0 };

/**
 * One port's pad frame as a poll gave it: the packed frame, on a flick's fire its direction and
 * button (`GamepadPoll.flicks`), and its presses (`fresh`: its bits the poll before lacked, with
 * their tilt and aim), which a later poll carries if this one never reaches the wire.
 */
interface PadFrame {
  readonly frame: InputFrame;
  readonly flick: InputFrame;
  readonly fresh: Carry;
}

const NO_PAD: PadFrame = { frame: 0, flick: 0, fresh: NO_CARRY };

/** A pad poll's bits that are presses a later poll may carry: all but the soft tilt and the flick's own mark. */
const PAD_PRESS_BITS = ~(Btn.Soft | Btn.Flick);

/**
 * A press with its tilt (Plan 6, Task 4 fix round 1). `Btn.Soft` is no press of its own (`PAD_PRESS_BITS`,
 * the keyboard's `EDGE_BUTTONS`), but a fresh direction plus Attack is a tilt with it and a smash
 * without (`Btn.Soft`), so a press that has a direction keeps the Soft of the frame it was read on:
 * a forward tilt carried across a stall is still a forward tilt.
 */
function pressWithTilt(press: InputFrame, read: InputFrame): InputFrame {
  return (press & DIRECTION_MASK) !== 0 ? press | (read & Btn.Soft) : press;
}

/**
 * `press`, read on `read`, as a carry: with its tilt, and an Attack's aim (fix round 2). An Attack
 * pressed under a soft direction held from before is a tilt that way (types.ts `Btn.Soft`), but
 * carried as Attack alone onto a frame with the stick at rest it is a jab. So it keeps that
 * direction, with its Soft, for a frame that holds none. Only a soft one: a hard direction held
 * from before would turn fresh on that frame, a smash where the press was a tilt.
 */
function carryOf(press: InputFrame, read: InputFrame): Carry {
  const held = read & DIRECTION_MASK;
  const aimed = (press & Btn.Attack) !== 0 && held !== 0 && (read & Btn.Soft) !== 0;
  return { press: pressWithTilt(press, read), aim: aimed ? held | Btn.Soft : 0 };
}

/** Two carries as one, the earlier first: their presses, and the earlier Attack's aim. */
function mergeCarries(earlier: Carry, later: Carry): Carry {
  return { press: earlier.press | later.press, aim: earlier.aim !== 0 ? earlier.aim : later.aim };
}

/**
 * `frame` with a carry joined: its presses, an Attack's aim if neither `frame` nor the presses hold
 * a direction, and their tilt unless `frame` holds a hard direction (one held without Soft).
 */
function joinCarried(frame: InputFrame, carry: Carry): InputFrame {
  const aimless = ((frame | carry.press) & DIRECTION_MASK) !== 0 || (carry.press & Btn.Attack) === 0;
  const carried = aimless ? carry.press : carry.press | carry.aim;
  const hard = (frame & DIRECTION_MASK) !== 0 && (frame & Btn.Soft) === 0;
  return frame | (hard ? carried & ~Btn.Soft : carried);
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
    presenter = null,
    background = null,
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
  /** How tall each fighter is drawn, from the bake, as of the last step (`drawnTop`). */
  let tops: readonly (number | null)[] = [];
  /** A Final Smash's draw shift, its release eased once a paint for both drawers (R-T17o). */
  const shiftEase = createSceneShiftEase();

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

  const cpuWorlds = matchCpuWorlds(stage, defs, getFighter, GAME_SIM_CONTEXT.bake, players.map((p) => p.cpuLevel !== null));

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
  const noCarries: readonly Carry[] = players.map(() => NO_CARRY);
  let carriedPresses = noCarries;
  // This tick's presses plus the carried ones, kept in case it is refused too.
  let tickPresses = noCarries;
  // A pad's right-stick flick (ruling R-FW3f, refined in Plan 5 final wave 5) is two
  // polls: its let-go of the left stick's direction, then its fire (`GamepadPoll.flicks`,
  // its direction and button). Each pad frame of it goes out whole and in order on a tick
  // that runs, in place of that tick's poll, so the frames scheduled are the ones the
  // unstalled flick schedules: one polled on a refused tick is owed (`owedPads`), the last
  // flick's only, so at most its two frames. Carried as bits alone, the fire landed on a poll
  // that already had back the direction the flick lets go of, fresh again beside its own (a
  // neutral air for a forward one), and a let-go lost with it never ended a dash (a dash
  // attack for a forward smash). The let-go is known on the fire's tick: the poll before,
  // owed if it never went out.
  const noPads: readonly (readonly PadFrame[])[] = players.map(() => []);
  let owedPads = noPads;
  // This tick's owed pad frames, its own flick's among them, kept in case it is refused.
  let tickPads = noPads;
  // A pad's fresh presses on polls that never reached the wire (Plan 6, Task 4): a poll a
  // refused or unscheduled tick read, one an owed flick frame went out in place of (Plan 5
  // final wave 5's cost: "a pad press held for that one poll alone is lost"), or an owed
  // frame a later flick's fire replaced (fix round 1). They join the next poll that goes out
  // whole, as a tapped key's do (`carriedPresses`).
  let carriedPadPresses = noCarries;
  // The same with the last poll's, if this tick found it lost, and any owed frame this tick's
  // fire replaced; kept in case this tick's input reaches no frame.
  let tickPadPresses = noCarries;
  // Each port's poll on the last tick and this one, and whether the last went out as polled.
  let lastPolls: readonly PadFrame[] = players.map(() => NO_PAD);
  let tickPolls = lastPolls;
  let lastPollsSent: readonly boolean[] = players.map(() => true);
  /** What `gatherInputs` gave each port on the last tick (`MatchRunner.lastInputs`). */
  let lastInputs: readonly InputFrame[] = noPresses;

  function gatherInputs(): InputFrame[] {
    const drained = keyboard ? keyboard.drain() : null;
    // Exactly once per tick: a pad's press edges are the diff against the last poll.
    const pads = gamepad ? gamepad.poll(players.length) : null;
    // A key's presses keep the Tilt key's Soft with their direction (fix round 1), and an Attack its aim (fix round 2).
    tickPresses = players.map((_, port) => mergeCarries(carriedPresses[port], carryOf(drained?.pressed[port] ?? 0, drained?.frames[port] ?? 0)));
    tickPolls = players.map((_, port) => {
      if (pads === null) return NO_PAD;
      const frame = pads.frames[port] ?? 0;
      return { frame, flick: pads.flicks[port] ?? 0, fresh: carryOf(frame & ~lastPolls[port].frame & PAD_PRESS_BITS, frame) };
    });
    tickPads = players.map((_, port) => {
      const poll = tickPolls[port];
      if (poll.flick === 0) return owedPads[port];
      // A fire: its let-go if that never went out, then itself, in place of anything still
      // owed, as two taps of one key in a stall make one press. So one flick's two frames are
      // all that is ever owed (part 5, fix round 1: appended, they piled up two a flick over a
      // long stall and drained one a tick, and a shield held after a 10 s stall flicked through
      // at 5 a second went out 50 ticks late, behind stale smashes).
      return [...(lastPollsSent[port] ? [] : [lastPolls[port]]), poll];
    });
    tickPadPresses = players.map((_, port) => {
      // The last poll missed the wire and goes out as no owed frame either (this tick's fire did
      // not take it for its let-go, and it is no flick frame still owed): its presses are carried.
      // Decided now, not on its own tick, so a let-go's presses go out once, in the let-go.
      const lost = !lastPollsSent[port] && !tickPads[port].includes(lastPolls[port]);
      // Owed frames this tick's fire replaced never go out either (fix round 1): their presses
      // are carried, but not a replaced fire's own direction and button, which the later flick
      // replaces (fix round 2: carried, they went out as a stale smash behind it).
      const replaced = owedPads[port].reduce(
        (carry, owed) => (tickPads[port].includes(owed) ? carry : mergeCarries(carry, { press: owed.fresh.press & ~owed.flick, aim: owed.fresh.aim })),
        NO_CARRY,
      );
      return mergeCarries(mergeCarries(carriedPadPresses[port], lost ? lastPolls[port].fresh : NO_CARRY), replaced);
    });
    return players.map((p, port) => {
      if (p.cpuLevel === null) {
        const keys = joinCarried(drained?.frames[port] ?? 0, carriedPresses[port]);
        const owed = tickPads[port];
        const pad = owed[0] ?? tickPolls[port];
        // Presses carried from polls that missed the wire ride the first poll that goes out whole.
        const carried = owed.length === 0 ? tickPadPresses[port] : NO_CARRY;
        return mergeKeyboardAndPad(keys, joinCarried(pad.frame, carried), pad.flick);
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
    lastInputs = inputs;
    if (session) {
      const result = session.advance(inputs);
      stalled = !result.advanced;
      if (!result.advanced || !result.localScheduled) {
        // This tick's input reached no frame: the session refused the frame, or ran
        // it with its input already scheduled because the automatic delay shrank
        // (`AdvanceResult.localScheduled`; Plan 6, Task 4). Either way this tick's
        // presses, a flick's pad frames and the pad presses carried so far wait for
        // the next tick.
        carriedPresses = tickPresses;
        carriedPadPresses = tickPadPresses;
        owedPads = tickPads;
        lastPolls = tickPolls;
        lastPollsSent = players.map(() => false);
      } else {
        carriedPresses = noCarries;
        // Sent with this tick's poll, or still waiting behind an owed frame.
        carriedPadPresses = tickPads.map((owed, port) => (owed.length === 0 ? NO_CARRY : tickPadPresses[port]));
        // The first owed pad frame went out; this tick's poll did if it was that one or none was owed.
        owedPads = tickPads.map((owed) => owed.slice(1));
        lastPollsSent = tickPads.map((owed, port) => owed.length === 0 || owed[0] === tickPolls[port]);
        lastPolls = tickPolls;
      }
      if (!result.advanced) {
        // A refused frame ran nothing new: nothing to age, sound or report. The
        // picture holds still instead of re-blending the last step.
        previous = state;
        return;
      }
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
    // the trackers that read cosmetic state off the fighters directly (ground
    // dust, launch trails, charge motes, damage smoke) and which nothing else
    // calls at all.
    //
    // How tall each fighter is drawn, from the bake, first: a scene keeps its user
    // whole and off the fighter it launches by it (Plan 5, Task 17), and the hit
    // sparks of the user's scene go where the user is drawn as this step is, its
    // eased shift with this step whole (fix round 4, ruling R-T17s).
    tops = state.fighters.map((f) => {
      const def = defs[f.port];
      return def ? drawnTop(def, f, state.frame, GAME_SIM_CONTEXT.bake) : null;
    });
    stepVfx(vfx, events, state, defs, peekSceneShift(shiftEase, sceneDrawShift(state, defs, tops), state.frame), getFighter);
    updateHud(hud, state);
    // The moves, for a Final Smash's end-hit punch-in, and the tops.
    updateCamera(camera, state, stage, events, defs, tops);

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

  const bgCtx = presenter && background ? background.getContext("2d") : null;

  function paint(alpha: number): void {
    if (!ctx) return;
    const drawn: RenderState = {
      current: state,
      previous,
      stage,
      fighters: defs,
      labels: players.map((p, i) => p.label ?? defs[i]?.name ?? ""),
      cpu: players.map((p) => p.cpuLevel !== null),
      portraits: presenter?.portraits?.(),
      vfx,
      hud,
      tops,
      // The 3D model's head, from the bake the sim steps with (Plan 4).
      anchors:
        presenter === null
          ? undefined
          : state.fighters.map((f) => {
              const def = defs[f.port];
              return def ? overlayAnchor(def, f, state.frame, GAME_SIM_CONTEXT.bake) : null;
            }),
    };
    // Between the last step and this one, `alpha` of the way, as the positions are drawn.
    const rs: RenderState = { ...drawn, sceneShift: easeSceneShift(shiftEase, sceneShiftAt(drawn, alpha), state.frame - 1 + alpha) };
    if (bgCtx) renderBackground(bgCtx, stage, camera, state.frame);
    // The overlay first: it is what knows a move effect hides its fighter this
    // frame. Both canvases reach the screen at the same composite either way.
    const overlay = render(ctx, rs, events, camera, alpha);
    if (presenter) presenter.paint(rs, camera, alpha, overlay.hidden);
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
      // On both paths: a lingering session only re-sends inputs, and draws nothing.
      presenter?.dispose();
    },
    get netStats() {
      return session ? session.stats() : null;
    },
    get stalled() {
      return stalled;
    },
    get lastInputs() {
      return lastInputs;
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
