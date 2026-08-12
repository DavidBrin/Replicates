/**
 * The keyboard input source: async DOM events in, one `InputFrame` per port
 * per tick out.
 *
 * The whole file exists because of one mismatch. DOM key events are
 * asynchronous and arrive whenever the OS delivers them; the simulation is a
 * fixed 60Hz stepper that asks "what is held?" once every 16.7ms. If the answer
 * is computed by reading a `heldKeys` set at tick time, then any key whose
 * entire press *and* release happened between two ticks never existed. That is
 * not a theoretical loss: a short hop is defined by releasing jump inside the
 * 3-frame jumpsquat (SPEC §6), so the shortest legal jump input is a tap, and a
 * tap on a good mechanical keyboard is routinely under 16ms. Sampling would
 * turn "short hop" into "nothing happened", intermittently, and the player
 * would call it lag.
 *
 * So the listeners **latch**. They maintain the held set *and* accumulate the
 * edges seen since the last tick, and the drained frame reports
 * `held ∪ pressedSinceLastDrain`. A key tapped between two ticks is therefore
 * reported as held for exactly one frame and released on the next, which is
 * precisely the input a human made — one frame is inside the 3-frame short-hop
 * window, so the hop survives. `drain()` is destructive and must be called
 * exactly once per simulation tick; that is the contract that keeps the edge
 * sets from being consumed twice or dropped.
 */

import { Btn, type InputFrame } from "@/engine/types";
import {
  ACTION_BUTTON,
  GAME_ACTIONS,
  assertSchemesCompatible,
  type GameAction,
  type Scheme,
} from "./schemes";

/* -------------------------------------------------------------- warnings -- */

/**
 * Surfaced by `/controls` next to any preset that binds a modifier.
 *
 * Windows watches for a modifier held past a system threshold and pops Sticky
 * Keys / Filter Keys itself, at a level below the browser. `preventDefault()`
 * cannot suppress it, `pointerLock` cannot suppress it, and fullscreen cannot
 * suppress it: by the time the page sees the event the OS has already decided.
 * The only real mitigations are the player's — turn the accessibility shortcut
 * off in Windows settings, or pick a preset that does not hold a modifier.
 * Config 2 binds `ShiftLeft` for shield, which is the longest-held key in the
 * game, so this warning is not hypothetical for it.
 */
export const STICKY_KEYS_WARNING =
  "Windows can interrupt play: holding Shift for about eight seconds opens Sticky Keys, " +
  "and holding it longer opens Filter Keys. No web page can suppress that prompt — it is " +
  "handled by the OS before the browser sees the key. Turn the shortcut off in " +
  "Settings > Accessibility > Keyboard, or choose a preset that does not use Shift.";

/** Codes that hand the OS or the browser a second meaning we cannot cancel. */
export const MODIFIER_CODES: readonly string[] = [
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
];

/** Player-facing warnings for a preset. Empty for a preset with no snags. */
export function schemeWarnings(scheme: Scheme): string[] {
  const warnings: string[] = [];
  const usesModifier = GAME_ACTIONS.some((a) => MODIFIER_CODES.includes(scheme.bindings[a]));
  if (usesModifier) warnings.push(STICKY_KEYS_WARNING);
  return warnings;
}

/* ------------------------------------------------------------ the source -- */

export interface PortBinding {
  /** Player port, 0-3. Indexes into the drained frame array. */
  readonly port: number;
  readonly scheme: Scheme;
}

export interface KeyboardOptions {
  /**
   * Where to listen. `window`, always, in production: a `keydown` bubbles to
   * the window whatever has focus inside the page, so binding to the canvas
   * would lose every key the moment the player clicked a HUD button.
   */
  readonly window?: Window;
  /**
   * Host for the "click to focus" overlay. Defaults to the target window's
   * `document.body`; pass `null` to suppress the overlay entirely (the netplay
   * lobby renders its own).
   */
  readonly overlayHost?: HTMLElement | null;
  readonly onFocusChange?: (focused: boolean) => void;
}

/**
 * What one tick's drain produced.
 *
 * `frames` is what the simulation consumes. `pressed` and `released` are the
 * raw edge masks that produced it, exposed for the input display on the debug
 * overlay and for tests — the simulation derives its own edges by comparing
 * consecutive frames (`pressed()` in `engine/types`), so it never reads these.
 */
export interface DrainResult {
  readonly frames: InputFrame[];
  readonly pressed: InputFrame[];
  readonly released: InputFrame[];
}

interface CodeTarget {
  readonly port: number;
  readonly action: GameAction;
  readonly button: Btn;
}

export class KeyboardInput {
  private readonly win: Window;
  private readonly bindings: readonly PortBinding[];
  private readonly codes = new Map<string, CodeTarget>();
  private readonly portCount: number;

  /** Physically down right now. */
  private readonly heldCodes = new Set<string>();
  /** Went down since the last drain — *including* keys already released again. */
  private readonly pressedCodes = new Set<string>();
  /** Came up since the last drain. */
  private readonly releasedCodes = new Set<string>();

  private attached = false;
  private focusedFlag = true;
  private overlay: FocusOverlay | null = null;
  private readonly overlayHost: HTMLElement | null | undefined;
  private readonly onFocusChange: ((focused: boolean) => void) | undefined;

  constructor(bindings: readonly PortBinding[], options: KeyboardOptions = {}) {
    // Two live schemes that share a key would mean two players driving one
    // fighter with no way to tell them apart. Refused at construction, not at
    // the first ambiguous keystroke. See `schemes.detectConflicts`.
    assertSchemesCompatible(bindings.map((b) => b.scheme));

    this.bindings = [...bindings];
    this.win = options.window ?? (globalThis as unknown as { window: Window }).window;
    this.overlayHost = options.overlayHost;
    this.onFocusChange = options.onFocusChange;

    let maxPort = -1;
    for (const { port, scheme } of this.bindings) {
      maxPort = Math.max(maxPort, port);
      for (const action of GAME_ACTIONS) {
        this.codes.set(scheme.bindings[action], {
          port,
          action,
          button: ACTION_BUTTON[action],
        });
      }
    }
    this.portCount = maxPort + 1;
  }

  /** Every physical key this instance will swallow. */
  get boundCodes(): string[] {
    return [...this.codes.keys()];
  }

  get focused(): boolean {
    return this.focusedFlag;
  }

  /** Player-facing warnings across all live presets, de-duplicated. */
  get warnings(): string[] {
    const all = this.bindings.flatMap((b) => schemeWarnings(b.scheme));
    return [...new Set(all)];
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;

    this.win.addEventListener("keydown", this.onKeyDown);
    this.win.addEventListener("keyup", this.onKeyUp);
    this.win.addEventListener("blur", this.onBlur);
    this.win.addEventListener("focus", this.onFocus);
    this.win.document?.addEventListener("visibilitychange", this.onVisibilityChange);

    if (this.overlayHost !== null) {
      const host = this.overlayHost ?? this.win.document?.body ?? null;
      if (host) this.overlay = new FocusOverlay(host, () => this.requestFocus());
    }
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    this.win.removeEventListener("keydown", this.onKeyDown);
    this.win.removeEventListener("keyup", this.onKeyUp);
    this.win.removeEventListener("blur", this.onBlur);
    this.win.removeEventListener("focus", this.onFocus);
    this.win.document?.removeEventListener("visibilitychange", this.onVisibilityChange);

    this.overlay?.destroy();
    this.overlay = null;
    this.clearAll();
  }

  /**
   * Take this tick's input and reset the edge accumulators. Destructive, and
   * must be called exactly once per simulation frame — call it twice and the
   * second call loses every tap that happened in between.
   */
  drain(): DrainResult {
    const frames = new Array<InputFrame>(this.portCount).fill(0);
    const pressed = new Array<InputFrame>(this.portCount).fill(0);
    const released = new Array<InputFrame>(this.portCount).fill(0);

    // A key that went down and back up between two ticks is in `pressedCodes`
    // and not in `heldCodes`; reporting the union is what makes it survive as
    // one frame of hold. A key held across the tick is in both, and the union
    // costs nothing.
    for (const code of this.heldCodes) {
      const t = this.codes.get(code);
      if (t) frames[t.port] |= t.button;
    }
    for (const code of this.pressedCodes) {
      const t = this.codes.get(code);
      if (!t) continue;
      frames[t.port] |= t.button;
      pressed[t.port] |= t.button;
    }
    for (const code of this.releasedCodes) {
      const t = this.codes.get(code);
      if (t) released[t.port] |= t.button;
    }

    this.pressedCodes.clear();
    this.releasedCodes.clear();

    return { frames, pressed, released };
  }

  /** Non-destructive: what `drain()` would return, without consuming edges. */
  peek(): InputFrame[] {
    const frames = new Array<InputFrame>(this.portCount).fill(0);
    for (const code of [...this.heldCodes, ...this.pressedCodes]) {
      const t = this.codes.get(code);
      if (t) frames[t.port] |= t.button;
    }
    return frames;
  }

  /** Put focus back on the game. Also called by the overlay's click handler. */
  requestFocus(): void {
    try {
      this.win.focus?.();
    } catch {
      // jsdom has no window manager, and a sandboxed iframe may refuse. The
      // click that got us here has already restored focus in a real browser.
    }
    this.setFocused(true);
  }

  /* ------------------------------------------------------------ handlers -- */

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code;
    if (!this.codes.has(code)) return;
    // The rebinding UI listens on a text field; swallowing keys there would
    // make it impossible to type a search or a lobby name.
    if (isEditable(event.target)) return;

    // Arrows scroll the page, `Slash` opens Firefox's Quick Find, `KeyQ` with
    // a stray modifier can close the tab. Every bound code is cancelled, and
    // only bound codes are — DevTools and the browser's own shortcuts stay
    // reachable.
    event.preventDefault();

    // The OS's auto-repeat fires `keydown` over and over while a key is held.
    // Feeding those into the edge set would look like a player mashing at the
    // repeat rate, which would re-trigger jumps and jabs from a held key.
    if (event.repeat) return;

    if (!this.heldCodes.has(code)) this.pressedCodes.add(code);
    this.heldCodes.add(code);
    this.setFocused(true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const code = event.code;
    if (!this.codes.has(code)) return;
    if (isEditable(event.target)) return;

    event.preventDefault();

    if (this.heldCodes.delete(code)) this.releasedCodes.add(code);
  };

  private readonly onBlur = (): void => {
    // Losing focus mid-match strands every held key down forever: the `keyup`
    // is delivered to whatever stole focus, so the fighter keeps running left
    // into the blast zone. Release everything, and say so loudly — on a shared
    // keyboard this kills *all* local players at once, so a silent failure
    // reads as the game having crashed.
    this.releaseAllHeld();
    this.setFocused(false);
  };

  private readonly onFocus = (): void => {
    this.setFocused(true);
  };

  private readonly onVisibilityChange = (): void => {
    const doc = this.win.document;
    if (doc && doc.visibilityState === "hidden") {
      this.releaseAllHeld();
      this.setFocused(false);
    }
  };

  /* --------------------------------------------------------------- inner -- */

  private setFocused(next: boolean): void {
    if (this.focusedFlag === next) return;
    this.focusedFlag = next;
    if (next) this.overlay?.hide();
    else this.overlay?.show();
    this.onFocusChange?.(next);
  }

  private releaseAllHeld(): void {
    for (const code of this.heldCodes) this.releasedCodes.add(code);
    this.heldCodes.clear();
  }

  private clearAll(): void {
    this.heldCodes.clear();
    this.pressedCodes.clear();
    this.releasedCodes.clear();
  }
}

export function createKeyboardInput(
  bindings: readonly PortBinding[],
  options: KeyboardOptions = {},
): KeyboardInput {
  return new KeyboardInput(bindings, options);
}

/* --------------------------------------------------------------- overlay -- */

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as { tagName?: unknown }).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export const FOCUS_OVERLAY_ID = "smash-focus-overlay";
export const FOCUS_OVERLAY_TEXT = "CLICK TO RESUME";
export const FOCUS_OVERLAY_SUBTEXT =
  "The window lost focus, so keyboard input is paused for every local player.";

/**
 * The "click to focus" curtain.
 *
 * Deliberately a full-screen blocker rather than a corner badge: when focus
 * goes, *nobody* on the couch can move, and the failure looks exactly like the
 * game freezing. Making the cause unmissable — and clickable — is cheaper than
 * fielding the bug report.
 */
class FocusOverlay {
  readonly element: HTMLElement;
  private readonly host: HTMLElement;
  private readonly handleClick: () => void;

  constructor(host: HTMLElement, onClick: () => void) {
    this.host = host;
    this.handleClick = onClick;

    const doc = host.ownerDocument;
    const el = doc.createElement("div");
    el.id = FOCUS_OVERLAY_ID;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", `${FOCUS_OVERLAY_TEXT}. ${FOCUS_OVERLAY_SUBTEXT}`);
    el.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:9999",
      "display:none",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "gap:0.75rem",
      "background:rgba(9,11,12,0.82)",
      "color:#FFD500",
      "font:700 clamp(1.5rem,5vw,3rem)/1 system-ui,sans-serif",
      "letter-spacing:0.08em",
      "text-align:center",
      "cursor:pointer",
      "user-select:none",
    ].join(";");

    const title = doc.createElement("div");
    title.textContent = FOCUS_OVERLAY_TEXT;
    title.style.cssText = "transform:skewX(-12deg)";

    const sub = doc.createElement("div");
    sub.textContent = FOCUS_OVERLAY_SUBTEXT;
    sub.style.cssText = "font:400 0.9rem/1.4 system-ui,sans-serif;color:#e6e6e6;max-width:32ch";

    el.append(title, sub);
    el.addEventListener("click", this.handleClick);
    el.addEventListener("keydown", this.onKey);
    host.appendChild(el);
    this.element = el;
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.code === "Enter" || event.code === "Space") this.handleClick();
  };

  show(): void {
    this.element.style.display = "flex";
  }

  hide(): void {
    this.element.style.display = "none";
  }

  destroy(): void {
    this.element.removeEventListener("click", this.handleClick);
    this.element.removeEventListener("keydown", this.onKey);
    if (this.element.parentNode === this.host) this.host.removeChild(this.element);
  }
}
