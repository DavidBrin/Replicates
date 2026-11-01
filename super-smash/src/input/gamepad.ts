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
 * Almost none of the stick's magnitude can ride along to the other peer:
 * `InputFrame` is a bitfield by contract (SPEC §3 — rollback compares inputs
 * with a single integer compare, 60 times a second, for every predicted frame),
 * so the packed frame is digital either way. Two parts of the analog signal do
 * survive packing. The first is one bit of magnitude, `Btn.Soft`: a stick held
 * in a direction but short of a full push sets it, and the engine reads it as
 * half deflection for a half-speed walk (and run acceleration) and a tilt
 * instead of a smash, and bends DI a quarter as far (`SOFT_DI_SHIFT`). DI is
 * linear in the stick (Plan 3), so that quarter is a stick at a quarter of its
 * throw, not half: one bit cannot be both, and the quarter is UNVERIFIED (D54).
 * The second is the part that matters most for smashes: a flick crosses the
 * direction threshold from zero in one frame and therefore produces a *fresh
 * press edge*, which is exactly the signal `SMASH_INPUT_WINDOW` keys off. The
 * full analog values are exposed on the poll result beside the frame, so the
 * local layer can use them without changing what goes over the wire.
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
  /** Plan 5: what a right-stick flick does (`rightStickFrame`); a smash attack when absent. */
  readonly rightStick?: RightStickMode;
  /** Plan 5: axis indices for the right stick; the standard mapping's 2 and 3. */
  readonly rightStickX?: number;
  readonly rightStickY?: number;
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
  rightStick: "smash",
  rightStickX: 2,
  rightStickY: 3,
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
   * Which port a pad drives, given the pad's place in connection order: 0 for
   * the connected pad with the lowest `Gamepad.index`, 1 for the next, and so
   * on. It is deliberately not the raw `Gamepad.index`, which is the browser's
   * slot number and can start above 0 (a replug, another HID device, Firefox).
   * Return a negative number or a port past `portCount` to drive nothing.
   * Defaults to identity — the first connected pad is port 0. The player-select
   * screen overwrites it once players pick their seats.
   */
  readonly portForPad?: (padOrdinal: number) => number;
  /**
   * Hold each pad to the port it took for as long as it stays connected — a
   * match, since the play page builds a reader per match. Without this, ports
   * follow connection order on every poll, so a pad below another unplugging
   * hands the one above it someone else's fighter. With it, a connected pad
   * never moves, and an unplugged pad's port goes to the first pad without
   * one, lowest connection ordinal first (a spare already connected, or the
   * next to plug in); until then it is idle. Ports are offered in
   * `portForPad`'s order.
   */
  readonly holdPorts?: boolean;
  /**
   * Plan 5: each port's own mapping (its player's remap on /controls), asked
   * for the port a pad drives. Overrides `mapping` when given.
   */
  readonly mappingForPort?: (port: number) => GamepadMapping;
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
  private readonly mappingForPort: (port: number) => GamepadMapping;
  private readonly deadzone: number;
  private readonly portForPad: (padOrdinal: number) => number;
  private readonly holdPorts: boolean;
  private readonly onConnectionChange: ((padIndex: number, connected: boolean) => void) | undefined;

  /** Last poll's packed frame per pad index, for edge detection. */
  private readonly lastFrames = new Map<number, InputFrame>();
  /**
   * Plan 5: last poll's right-stick direction per pad index, absent until the
   * stick has been seen at rest (R-T21a), and a flick waiting for its second frame.
   */
  private readonly lastRight = new Map<number, InputFrame>();
  private readonly pendingRight = new Map<number, InputFrame>();
  private readonly connected = new Set<number>();
  /** With `holdPorts`: the port each seated pad holds, by pad index. */
  private readonly heldPorts = new Map<number, number>();
  private attached = false;

  constructor(options: GamepadOptions = {}) {
    this.win = options.window ?? (globalThis as { window?: Window }).window;
    this.nav = options.navigator ?? this.win?.navigator;
    const mapping = options.mapping ?? STANDARD_MAPPING;
    this.mappingForPort = options.mappingForPort ?? (() => mapping);
    this.deadzone = options.deadzone ?? RADIAL_DEADZONE;
    this.portForPad = options.portForPad ?? ((i) => i);
    this.holdPorts = options.holdPorts ?? false;
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
    this.lastRight.clear();
    this.pendingRight.clear();
    this.connected.clear();
    this.heldPorts.clear();
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

    // Ports follow connection order, not the slot number: a lone pad in slot 1
    // is the first pad, so it must drive the first port.
    const pads = padsInOrder(this.supported ? this.nav!.getGamepads() : []);
    if (this.holdPorts) this.releaseUnplugged(pads);
    for (const [ordinal, pad] of pads.entries()) {
      const port = this.holdPorts ? this.heldPortFor(pad.index, portCount) : this.portForPad(ordinal);
      if (port < 0 || port >= portCount) continue;
      seen.push(pad.index);

      const mapping = this.mappingForPort(port);
      const stick = this.readStick(pad, mapping);
      const frame = this.rightStickFrame(pad, mapping, this.packFrame(pad, stick, mapping));
      const previous = this.lastFrames.get(pad.index) ?? 0;

      // `Btn.Soft` is a modifier on a direction, not a button: its coming and
      // going is not a press or a release.
      const buttons = ~Btn.Soft;
      frames[port] |= frame;
      pressed[port] |= frame & ~previous & buttons;
      released[port] |= previous & ~frame & buttons;
      sticks[port] = stick;

      this.lastFrames.set(pad.index, frame);
      this.connected.add(pad.index);
    }

    // A pad unplugged mid-match must not leave its last frame latched, or the
    // fighter runs off the stage holding a direction nobody is pressing.
    for (const index of [...this.lastFrames.keys()]) {
      if (!seen.includes(index)) this.lastFrames.delete(index);
    }
    // Nor a right-stick flick its second frame.
    for (const index of [...this.lastRight.keys()]) {
      if (!seen.includes(index)) {
        this.lastRight.delete(index);
        this.pendingRight.delete(index);
      }
    }

    return { frames, pressed, released, sticks, connectedPads: seen };
  }

  /** An unplugged pad gives up its port, for a pad without one to take. */
  private releaseUnplugged(pads: readonly Gamepad[]): void {
    for (const index of [...this.heldPorts.keys()]) {
      if (!pads.some((pad) => pad.index === index)) this.heldPorts.delete(index);
    }
  }

  /**
   * The port a connected pad holds, or -1. A pad without one takes the first
   * port in `portForPad`'s order that no connected pad holds, and keeps it
   * while it stays connected; with every port held it asks again next poll.
   * `poll` asks in connection order, so the lowest ordinal is seated first.
   */
  private heldPortFor(index: number, portCount: number): number {
    const held = this.heldPorts.get(index);
    if (held !== undefined) return held;
    const taken = new Set(this.heldPorts.values());
    for (let ordinal = 0; ordinal < portCount; ordinal++) {
      const port = this.portForPad(ordinal);
      if (port >= 0 && port < portCount && !taken.has(port)) {
        this.heldPorts.set(index, port);
        return port;
      }
    }
    return -1;
  }

  private readStick(pad: Gamepad, mapping: GamepadMapping): Stick {
    const rawX = pad.axes[mapping.stickX] ?? 0;
    // Pads report +Y downwards; the simulation's +Y is up (SPEC §8's blast
    // zones are positive at the top), so the axis is negated once, here.
    const rawY = -(pad.axes[mapping.stickY] ?? 0);
    return radialDeadzone(rawX, rawY, this.deadzone);
  }

  private packFrame(pad: Gamepad, stick: Stick, mapping: GamepadMapping): InputFrame {
    let frame: InputFrame = 0;

    for (const [name, bit] of BUTTON_ORDER) {
      const indices = mapping[name] as readonly number[];
      for (const i of indices) {
        if (pad.buttons[i]?.pressed) {
          frame |= bit;
          break;
        }
      }
    }

    // The stick contributes the same direction bits as the d-pad, OR'd, so a
    // player may use either without a mode switch.
    const fromPad = frame & DIRECTION_MASK;
    let fromStick: InputFrame = 0;
    if (stick.x >= WALK_THRESHOLD) fromStick |= Btn.Right;
    else if (stick.x <= -WALK_THRESHOLD) fromStick |= Btn.Left;
    if (stick.y >= WALK_THRESHOLD) fromStick |= Btn.Up;
    else if (stick.y <= -WALK_THRESHOLD) fromStick |= Btn.Down;
    frame |= fromStick;

    // The one thing the magnitude can carry over the wire: "not all the way".
    // A d-pad is digital, so a held d-pad direction is never soft.
    if (fromStick !== 0 && fromPad === 0 && stick.magnitude < DASH_THRESHOLD) frame |= Btn.Soft;

    return frame;
  }

  /**
   * Plan 5: a right-stick flick, from neutral past the walk threshold, is a
   * smash attack in its direction, or a special (SmashWiki "C-Stick",
   * https://www.ssbwiki.com/C-Stick: in Ultimate it "is primarily used to
   * perform smash attacks", and can be set to special moves, "B-sticking").
   * The packed frame is digital, and the simulation reads a smash as a fresh
   * direction press with the attack button (`SMASH_INPUT_WINDOW`), so the
   * flick lets go of the left stick's direction for one frame and presses its
   * own, at full strength, with the button on the next. The same page says
   * the stick "requires sacrificing control with the Control Stick for at
   * least one frame" and that its smash attacks "are performed one frame
   * slower than the fastest possible".
   * UNVERIFIED-simplified: this frame-by-frame shape is the replica's own,
   * and holding the stick does not charge the smash, as Ultimate's does
   * (same page): the button is pressed for the one frame.
   *
   * Ruling R-T21a: only a pad with the W3C standard mapping has its right
   * stick on axes 2 and 3; on another layout they may be triggers, which rest
   * at an end of their travel, so such a pad gets no flick at all. And a
   * flick starts from rest: until the stick has been seen inside the dead
   * zone, a deflection (on the first poll, or held since the pad connected)
   * never fires.
   */
  private rightStickFrame(pad: Gamepad, mapping: GamepadMapping, frame: InputFrame): InputFrame {
    const mode = mapping.rightStick ?? "smash";
    if (mode === "off" || pad.mapping !== "standard") return frame;
    const r = radialDeadzone(pad.axes[mapping.rightStickX ?? 2] ?? 0, -(pad.axes[mapping.rightStickY ?? 3] ?? 0), this.deadzone);
    // One of four directions, the larger axis: smash attacks and specials are four-way.
    const dir: InputFrame =
      r.magnitude < WALK_THRESHOLD ? 0 : Math.abs(r.x) >= Math.abs(r.y) ? (r.x > 0 ? Btn.Right : Btn.Left) : r.y > 0 ? Btn.Up : Btn.Down;
    const previous = this.lastRight.get(pad.index);
    if (previous === undefined && r.magnitude > 0) return frame;
    this.lastRight.set(pad.index, dir);
    const body = frame & ~(DIRECTION_MASK | Btn.Soft);
    const pending = this.pendingRight.get(pad.index);
    if (pending !== undefined) {
      this.pendingRight.delete(pad.index);
      return body | pending | (mode === "smash" ? Btn.Attack : Btn.Special);
    }
    if (dir !== 0 && previous === 0) {
      this.pendingRight.set(pad.index, dir);
      return body;
    }
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
    this.lastRight.delete(index);
    this.pendingRight.delete(index);
    this.onConnectionChange?.(index, false);
  };
}

export function createGamepadInput(options: GamepadOptions = {}): GamepadInput {
  return new GamepadInput(options);
}

/**
 * The connected pads in connection order: sorted by `Gamepad.index`, with the
 * holes `getGamepads()` leaves for empty slots and any disconnected pad left
 * out. A pad's place in this list is its ordinal (`portForPad`), wherever the
 * pads are read: the match, or the capture on /controls.
 */
export function padsInOrder(pads: readonly (Gamepad | null)[]): Gamepad[] {
  return pads.filter((pad): pad is Gamepad => !!pad && pad.connected).sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------- combining -- */

export const DIRECTION_MASK: InputFrame = Btn.Left | Btn.Right | Btn.Up | Btn.Down;

/**
 * One port's frame from both devices.
 *
 * A key is a full deflection, so a direction held on the keyboard cancels the
 * stick's "soft": otherwise a player resting a thumb on the stick could never
 * dash with the arrow keys.
 */
export function mergeKeyboardAndPad(keys: InputFrame, pad: InputFrame): InputFrame {
  const merged = keys | pad;
  return (keys & DIRECTION_MASK) !== 0 ? merged & ~Btn.Soft : merged;
}

/**
 * `ports` lists the human ports in order: the first connected pad drives
 * `ports[0]`, the second connected pad `ports[1]`, and extra pads drive
 * nothing (-1).
 *
 * The argument is the pad's place in connection order (what `GamepadInput`
 * passes to `portForPad`), not the browser's `Gamepad.index` slot, so a lone
 * pad that landed in slot 1 still drives the first human port.
 */
export function padPortMap(ports: readonly number[]): (padOrdinal: number) => number {
  return (padOrdinal) => ports[padOrdinal] ?? -1;
}

/* ---------------------------------------------------------- remap (Plan 5) -- */

/**
 * The pad actions a player can rebind on /controls: Ultimate's "standard"
 * actions, which "can be set to any of the available buttons" (SmashWiki
 * "Controls", https://www.ssbwiki.com/Controls). Directions stay on the stick
 * and the d-pad.
 */
export type PadAction = "attack" | "special" | "jump" | "shield" | "grab";
export const PAD_ACTIONS: readonly PadAction[] = ["attack", "special", "jump", "shield", "grab"];

/**
 * What the right stick does: a smash attack (its main use, SmashWiki
 * "C-Stick"), a special, or nothing. Ultimate also offers tilt attacks there;
 * the replica does not.
 */
export type RightStickMode = "smash" | "special" | "off";
export const RIGHT_STICK_MODES: readonly RightStickMode[] = ["smash", "special", "off"];

/** One player's pad settings: the buttons on each action, and the right stick. */
export interface PadSettings {
  readonly buttons: Readonly<Record<PadAction, readonly number[]>>;
  readonly rightStick: RightStickMode;
}

export const DEFAULT_PAD_SETTINGS: PadSettings = {
  buttons: {
    attack: STANDARD_MAPPING.attack,
    special: STANDARD_MAPPING.special,
    jump: STANDARD_MAPPING.jump,
    shield: STANDARD_MAPPING.shield,
    grab: STANDARD_MAPPING.grab,
  },
  rightStick: "smash",
};

/**
 * `button` now does `action` alone: it leaves every other action it was on.
 * An action that would be left with no button at all takes the buttons
 * `action` had (a swap), so no action, jump and attack above all, is ever
 * unbound.
 */
export function rebind(settings: PadSettings, action: PadAction, button: number): PadSettings {
  const before = settings.buttons[action].filter((b) => b !== button);
  const buttons = {} as Record<PadAction, readonly number[]>;
  for (const a of PAD_ACTIONS) {
    if (a === action) {
      buttons[a] = [button];
      continue;
    }
    const kept = settings.buttons[a].filter((b) => b !== button);
    buttons[a] = kept.length > 0 || settings.buttons[a].length === 0 ? kept : before;
  }
  return { ...settings, buttons };
}

/**
 * The mapping `GamepadInput` reads for a player's settings: the five actions
 * and the right stick, over the standard mapping. A d-pad button bound to an
 * action stops being that direction (it would otherwise do both).
 */
export function mappingFrom(settings: PadSettings): GamepadMapping {
  const { attack, special, jump, shield, grab } = settings.buttons;
  const bound = new Set([...attack, ...special, ...jump, ...shield, ...grab]);
  const free = (dir: readonly number[]) => dir.filter((b) => !bound.has(b));
  return {
    ...STANDARD_MAPPING,
    attack,
    special,
    jump,
    shield,
    grab,
    up: free(STANDARD_MAPPING.up),
    down: free(STANDARD_MAPPING.down),
    left: free(STANDARD_MAPPING.left),
    right: free(STANDARD_MAPPING.right),
    rightStick: settings.rightStick,
  };
}

/** The most buttons one action keeps. */
const MAX_BUTTONS_PER_ACTION = 8;

/**
 * Button numbers a pad's settings may hold run from 0 to one below this (the
 * standard mapping has 17). The capture on /controls and the storage check
 * share it, so a capture never makes settings a reload would refuse (R-T21b).
 */
export const PAD_BUTTON_LIMIT = 32;

/**
 * Is `value` well-formed `PadSettings` (read back from storage)? Each action
 * has one to eight buttons, each a button number a pad can have, and no
 * button is on two actions, as `rebind` keeps it.
 */
export function isPadSettings(value: unknown): value is PadSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { buttons?: unknown; rightStick?: unknown };
  if (!RIGHT_STICK_MODES.includes(v.rightStick as RightStickMode)) return false;
  if (typeof v.buttons !== "object" || v.buttons === null) return false;
  const buttons = v.buttons as Record<string, unknown>;
  const seen = new Set<number>();
  return PAD_ACTIONS.every((a) => {
    const list = buttons[a];
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BUTTONS_PER_ACTION) return false;
    return list.every((b: unknown) => {
      if (!Number.isInteger(b) || (b as number) < 0 || (b as number) >= PAD_BUTTON_LIMIT || seen.has(b as number)) return false;
      seen.add(b as number);
      return true;
    });
  });
}

const BUTTON_NAMES: readonly string[] = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "Up", "Down", "Left", "Right", "Home"];

/** A standard-mapping button's usual name. */
export function padButtonName(index: number): string {
  return BUTTON_NAMES[index] ?? `Button ${index}`;
}
