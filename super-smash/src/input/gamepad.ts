/**
 * The optional second input path: the Gamepad API.
 *
 * Two things about that API shape this file. First, it is a **pull** model —
 * only `gamepadconnected` and `gamepaddisconnected` are events, and button
 * state is read by calling `navigator.getGamepads()` and looking at a snapshot.
 * There is no "button went down" notification, so edges are recovered by
 * diffing this poll against the last one, and the poll happens exactly once per
 * simulation tick so that the diff lines up with a frame. (The keyboard path is
 * strictly better here: it latches a tap that begins and ends between two
 * ticks, and no amount of polling can recover one. A pad tap shorter than 16ms
 * is genuinely lost — but pads have travel and springs, and a sub-frame press
 * is close to physically impossible on one.)
 *
 * Second, an analog stick makes most of SPEC §6's timing heuristics
 * unnecessary. On a keyboard, "walk vs. dash" has to be recovered from how long
 * a direction was held and "tilt vs. smash" from how recently it was pressed,
 * because a key is always 100% deflected and instantaneous. A stick reports
 * *how far* and, frame to frame, *how fast* — which is what the real game reads:
 * magnitude past the walk threshold but under the dash threshold is a walk, and
 * a large deflection change inside a couple of frames is a smash. Those
 * distinctions are native here rather than inferred.
 *
 * What the stick's magnitude cannot do is ride along to the other peer:
 * `InputFrame` is a bitfield by contract (SPEC §3 — rollback compares inputs
 * with a single integer compare, 60 times a second, for every predicted frame),
 * so the packed frame is digital either way. The analog values are exposed on
 * the poll result beside the frame, so the local layer can use them without
 * changing what goes over the wire, and the one part that survives packing is
 * the part that matters most: a flick crosses the direction threshold from zero
 * in one frame and therefore produces a *fresh press edge*, which is exactly
 * the signal `SMASH_INPUT_WINDOW` keys off.
 */

import { Btn, type InputFrame } from "@/engine/types";

/* -------------------------------------------------------------- deadzones -- */

/**
 * Radial deadzone radius, as a fraction of full deflection.
 *
 * ~0.18 covers the drift of a worn stick without eating the slow walk. It is
 * applied **radially** — on the magnitude of the XY vector — and not per axis.
 * Per-axis clamping is the common shortcut and it biases diagonals two ways at
 * once: a stick pushed to a perfect 45° at 0.2 total deflection has 0.14 on
 * each axis, so both are zeroed and the input vanishes, while the same 0.2
 * pushed straight along an axis registers. The dead region becomes a square
 * instead of a circle, and the player feels it as "diagonals need a harder
 * push".
 */
export const RADIAL_DEADZONE = 0.18;

/** Deflection at which a direction bit is set at all. Below it, neutral. */
export const WALK_THRESHOLD = 0.28;
/** Deflection treated as a full-strength hold — dash, smash, hard DI. */
export const DASH_THRESHOLD = 0.72;

export interface Stick {
  readonly x: number;
  readonly y: number;
  /** Length of `(x, y)` after the deadzone, in [0, 1]. */
  readonly magnitude: number;
}

export const NEUTRAL_STICK: Stick = { x: 0, y: 0, magnitude: 0 };

/**
 * Normalise the vector, zero it below the deadzone, and rescale the remainder
 * from the deadzone edge so the usable range still runs 0 → 1.
 *
 * Rescaling is the half people skip. Without it the stick jumps from 0 to 0.18
 * the instant it leaves the dead region, and every fine movement — a walk, a
 * tilt, weak DI — is unreachable. With it, the first millimetre of travel past
 * the deadzone is still a nudge.
 *
 * `Math.sqrt` rather than `Math.hypot`: `sqrt` is correctly rounded by IEEE-754
 * and `hypot` is explicitly allowed to be implementation-defined. Nothing here
 * enters `GameState` — the caller only ever ships the packed bitfield — but
 * keeping the input layer to the same discipline as `fixed.ts` means there is
 * one rule rather than a rule with an exception (SPEC §3).
 */
export function radialDeadzone(x: number, y: number, deadzone = RADIAL_DEADZONE): Stick {
  const raw = Math.sqrt(x * x + y * y);
  if (raw <= deadzone || raw === 0) return NEUTRAL_STICK;

  // Clamped to 1: a stick reporting ±1 on both axes has a raw magnitude of
  // 1.414, and the frame must never claim more than full deflection.
  const scaled = Math.min((raw - deadzone) / (1 - deadzone), 1);
  return { x: (x / raw) * scaled, y: (y / raw) * scaled, magnitude: scaled };
}

/* ---------------------------------------------------------------- mapping -- */

/**
 * Button indices in the W3C "standard" mapping, laid out the way Ultimate's
 * default controller does: A attacks, B specials, X/Y jump, the shoulders
 * shield, and the right bumper is the dedicated grab (Ultimate's Z).
 */
export interface GamepadMapping {
  readonly attack: readonly number[];
  readonly special: readonly number[];
  readonly jump: readonly number[];
  readonly shield: readonly number[];
  readonly grab: readonly number[];
  readonly up: readonly number[];
  readonly down: readonly number[];
  readonly left: readonly number[];
  readonly right: readonly number[];
  /** Axis indices for the left stick. Y is inverted below: pads report +Y down. */
  readonly stickX: number;
  readonly stickY: number;
}

export const STANDARD_MAPPING: GamepadMapping = {
  attack: [0], // A
  special: [1], // B
  jump: [2, 3], // X, Y
  shield: [4, 6, 7], // LB, LT, RT
  grab: [5], // RB — Ultimate's Z
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  stickX: 0,
  stickY: 1,
};

const BUTTON_ORDER: readonly (readonly [keyof GamepadMapping, Btn])[] = [
  ["attack", Btn.Attack],
  ["special", Btn.Special],
  ["jump", Btn.Jump],
  ["shield", Btn.Shield],
  ["grab", Btn.Grab],
  ["up", Btn.Up],
  ["down", Btn.Down],
  ["left", Btn.Left],
  ["right", Btn.Right],
];

/* ----------------------------------------------------------------- source -- */

export interface GamepadOptions {
  readonly window?: Window;
  readonly navigator?: Navigator;
  readonly mapping?: GamepadMapping;
  readonly deadzone?: number;
  /**
   * Which pad index drives which port. Defaults to identity — pad 0 is port 0.
   * The player-select screen overwrites it once players pick their seats.
   */
  readonly portForPad?: (padIndex: number) => number;
  readonly onConnectionChange?: (padIndex: number, connected: boolean) => void;
}

export interface GamepadPoll {
  /** Indexed by port. Ports with no pad attached are 0. */
  readonly frames: InputFrame[];
  /** Buttons that went down since the previous poll, indexed by port. */
  readonly pressed: InputFrame[];
  readonly released: InputFrame[];
  /** Post-deadzone left stick, indexed by port. */
  readonly sticks: Stick[];
  readonly connectedPads: readonly number[];
}

export class GamepadInput {
  private readonly win: Window | undefined;
  private readonly nav: Navigator | undefined;
  private readonly mapping: GamepadMapping;
  private readonly deadzone: number;
  private readonly portForPad: (padIndex: number) => number;
  private readonly onConnectionChange: ((padIndex: number, connected: boolean) => void) | undefined;

  /** Last poll's packed frame per pad index, for edge detection. */
  private readonly lastFrames = new Map<number, InputFrame>();
  private readonly connected = new Set<number>();
  private attached = false;

  constructor(options: GamepadOptions = {}) {
    this.win = options.window ?? (globalThis as { window?: Window }).window;
    this.nav = options.navigator ?? this.win?.navigator;
    this.mapping = options.mapping ?? STANDARD_MAPPING;
    this.deadzone = options.deadzone ?? RADIAL_DEADZONE;
    this.portForPad = options.portForPad ?? ((i) => i);
    this.onConnectionChange = options.onConnectionChange;
  }

  /** True when the browser exposes the API at all. Safari behind a flag, etc. */
  get supported(): boolean {
    return typeof this.nav?.getGamepads === "function";
  }

  get connectedPads(): number[] {
    return [...this.connected].sort((a, b) => a - b);
  }

  attach(): void {
    if (this.attached || !this.win) return;
    this.attached = true;
    this.win.addEventListener("gamepadconnected", this.onConnected);
    this.win.addEventListener("gamepaddisconnected", this.onDisconnected);
  }

  detach(): void {
    if (!this.attached || !this.win) return;
    this.attached = false;
    this.win.removeEventListener("gamepadconnected", this.onConnected);
    this.win.removeEventListener("gamepaddisconnected", this.onDisconnected);
    this.lastFrames.clear();
    this.connected.clear();
  }

  /**
   * Read every attached pad once. Call exactly once per simulation tick — the
   * edge masks are the diff against the previous call, so an extra call reports
   * a frame's presses as already-held and loses them.
   */
  poll(portCount = 4): GamepadPoll {
    const frames = new Array<InputFrame>(portCount).fill(0);
    const pressed = new Array<InputFrame>(portCount).fill(0);
    const released = new Array<InputFrame>(portCount).fill(0);
    const sticks = new Array<Stick>(portCount).fill(NEUTRAL_STICK);
    const seen: number[] = [];

    const pads = this.supported ? this.nav!.getGamepads() : [];
    for (const pad of pads) {
      // `getGamepads()` returns a sparse array with holes for empty slots.
      if (!pad || !pad.connected) continue;
      const port = this.portForPad(pad.index);
      if (port < 0 || port >= portCount) continue;
      seen.push(pad.index);

      const stick = this.readStick(pad);
      const frame = this.packFrame(pad, stick);
      const previous = this.lastFrames.get(pad.index) ?? 0;

      frames[port] |= frame;
      pressed[port] |= frame & ~previous;
      released[port] |= previous & ~frame;
      sticks[port] = stick;

      this.lastFrames.set(pad.index, frame);
      this.connected.add(pad.index);
    }

    // A pad unplugged mid-match must not leave its last frame latched, or the
    // fighter runs off the stage holding a direction nobody is pressing.
    for (const index of [...this.lastFrames.keys()]) {
      if (!seen.includes(index)) this.lastFrames.delete(index);
    }

    return { frames, pressed, released, sticks, connectedPads: seen };
  }

  private readStick(pad: Gamepad): Stick {
    const rawX = pad.axes[this.mapping.stickX] ?? 0;
    // Pads report +Y downwards; the simulation's +Y is up (SPEC §8's blast
    // zones are positive at the top), so the axis is negated once, here.
    const rawY = -(pad.axes[this.mapping.stickY] ?? 0);
    return radialDeadzone(rawX, rawY, this.deadzone);
  }

  private packFrame(pad: Gamepad, stick: Stick): InputFrame {
    let frame: InputFrame = 0;

    for (const [name, bit] of BUTTON_ORDER) {
      const indices = this.mapping[name] as readonly number[];
      for (const i of indices) {
        if (pad.buttons[i]?.pressed) {
          frame |= bit;
          break;
        }
      }
    }

    // The stick contributes the same direction bits as the d-pad, OR'd, so a
    // player may use either without a mode switch.
    if (stick.x >= WALK_THRESHOLD) frame |= Btn.Right;
    else if (stick.x <= -WALK_THRESHOLD) frame |= Btn.Left;
    if (stick.y >= WALK_THRESHOLD) frame |= Btn.Up;
    else if (stick.y <= -WALK_THRESHOLD) frame |= Btn.Down;

    return frame;
  }

  private readonly onConnected = (event: Event): void => {
    const index = (event as GamepadEvent).gamepad?.index;
    if (typeof index !== "number") return;
    this.connected.add(index);
    this.onConnectionChange?.(index, true);
  };

  private readonly onDisconnected = (event: Event): void => {
    const index = (event as GamepadEvent).gamepad?.index;
    if (typeof index !== "number") return;
    this.connected.delete(index);
    this.lastFrames.delete(index);
    this.onConnectionChange?.(index, false);
  };
}

export function createGamepadInput(options: GamepadOptions = {}): GamepadInput {
  return new GamepadInput(options);
}
