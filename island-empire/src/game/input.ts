/**
 * One pointer path for mouse and touch (SPEC §9): tap, drag-pan past a
 * 6 px threshold, wheel zoom, two-finger pinch, plus additive keyboard
 * shortcuts. `GestureTracker` is pure so the classification is unit-tested
 * without a DOM; `attachInput` is the thin browser binding around it.
 */

export const DRAG_THRESHOLD_PX = 6;
export const KEY_PAN_PX = 48;
export const KEY_ZOOM_FACTOR = 1.2;
export const WHEEL_ZOOM_RATE = 0.0015;

export type Gesture =
  | { type: "tap"; x: number; y: number }
  | { type: "pan"; dx: number; dy: number }
  | { type: "pinch"; factor: number; cx: number; cy: number };

interface Pointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export class GestureTracker {
  private pointers = new Map<number, Pointer>();
  private dragging = false;
  private tapCancelled = false;
  private lastPinchDist = 0;
  private lastCentre = { x: 0, y: 0 };

  down(id: number, x: number, y: number): Gesture[] {
    this.pointers.set(id, { x, y, startX: x, startY: y });
    if (this.pointers.size === 2) {
      this.tapCancelled = true;
      this.dragging = false;
      const [a, b] = [...this.pointers.values()];
      this.lastPinchDist = dist(a!, b!);
      this.lastCentre = centre(a!, b!);
    } else if (this.pointers.size === 1) {
      this.dragging = false;
      this.tapCancelled = false;
    }
    return [];
  }

  move(id: number, x: number, y: number): Gesture[] {
    const p = this.pointers.get(id);
    if (!p) return [];
    const out: Gesture[] = [];
    if (this.pointers.size >= 2) {
      p.x = x;
      p.y = y;
      const [a, b] = [...this.pointers.values()];
      const d = dist(a!, b!);
      const c = centre(a!, b!);
      if (this.lastPinchDist > 0 && d > 0) {
        const factor = d / this.lastPinchDist;
        if (factor !== 1) out.push({ type: "pinch", factor, cx: c.x, cy: c.y });
      }
      const dx = c.x - this.lastCentre.x;
      const dy = c.y - this.lastCentre.y;
      if (dx !== 0 || dy !== 0) out.push({ type: "pan", dx, dy });
      this.lastPinchDist = d;
      this.lastCentre = c;
      return out;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (!this.dragging) {
      const moved = Math.hypot(x - p.startX, y - p.startY);
      if (moved >= DRAG_THRESHOLD_PX) {
        this.dragging = true;
        this.tapCancelled = true;
        // emit the whole displacement so the first frame does not snap
        out.push({ type: "pan", dx: x - p.startX, dy: y - p.startY });
      }
      return out;
    }
    out.push({ type: "pan", dx, dy });
    return out;
  }

  up(id: number, x: number, y: number): Gesture[] {
    const p = this.pointers.get(id);
    if (!p) return [];
    this.pointers.delete(id);
    const out: Gesture[] = [];
    if (this.pointers.size === 0) {
      if (!this.dragging && !this.tapCancelled) out.push({ type: "tap", x, y });
      this.dragging = false;
      this.tapCancelled = false;
    } else if (this.pointers.size === 1) {
      // the remaining finger continues as a plain drag from where it is
      const rest = [...this.pointers.values()][0]!;
      rest.startX = rest.x;
      rest.startY = rest.y;
      this.dragging = true;
      this.tapCancelled = true;
    }
    return out;
  }

  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.tapCancelled = false;
    }
  }

  get activePointers(): number {
    return this.pointers.size;
  }
}

function dist(a: Pointer, b: Pointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centre(a: Pointer, b: Pointer): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export type KeyCommand =
  | { type: "escape" }
  | { type: "undo" }
  | { type: "nextDay" }
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; factor: number };

/** Maps a keyboard event's `key`/`code` to a command, or null. */
export function classifyKey(key: string, code: string): KeyCommand | null {
  switch (code) {
    case "Escape":
      return { type: "escape" };
    case "KeyZ":
      return { type: "undo" };
    case "Enter":
    case "NumpadEnter":
      return { type: "nextDay" };
    case "ArrowLeft":
    case "KeyA":
      return { type: "pan", dx: KEY_PAN_PX, dy: 0 };
    case "ArrowRight":
    case "KeyD":
      return { type: "pan", dx: -KEY_PAN_PX, dy: 0 };
    case "ArrowUp":
    case "KeyW":
      return { type: "pan", dx: 0, dy: KEY_PAN_PX };
    case "ArrowDown":
    case "KeyS":
      return { type: "pan", dx: 0, dy: -KEY_PAN_PX };
    default:
      break;
  }
  if (key === "+" || key === "=") return { type: "zoom", factor: KEY_ZOOM_FACTOR };
  if (key === "-" || key === "_") return { type: "zoom", factor: 1 / KEY_ZOOM_FACTOR };
  return null;
}

export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_RATE);
}

export interface InputHandlers {
  onGesture(g: Gesture): void;
  onKey(cmd: KeyCommand): void;
}

/** Bind pointer/wheel/keyboard listeners; returns the detach function. */
export function attachInput(canvas: HTMLCanvasElement, handlers: InputHandlers): () => void {
  const tracker = new GestureTracker();
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const emit = (gs: Gesture[]) => {
    for (const g of gs) handlers.onGesture(g);
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // Synthetic pointer events (tests, some assistive tech) carry ids the
    // browser has no active pointer for, and capture then throws NotFoundError.
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* not a real pointer — nothing to capture */
    }
    const p = local(e);
    emit(tracker.down(e.pointerId, p.x, p.y));
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    const p = local(e);
    emit(tracker.move(e.pointerId, p.x, p.y));
  };
  const up = (e: PointerEvent) => {
    const p = local(e);
    emit(tracker.up(e.pointerId, p.x, p.y));
    try {
      canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      /* see setPointerCapture above */
    }
  };
  const cancel = (e: PointerEvent) => tracker.cancel(e.pointerId);
  const wheel = (e: WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    handlers.onGesture({ type: "pinch", factor: wheelZoomFactor(e.deltaY), cx: e.clientX - r.left, cy: e.clientY - r.top });
    e.preventDefault();
  };
  const key = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    // Shortcuts belong to the board: never steal Enter/Z/arrows from a focused
    // button, select, link or editable element (a keyboard user tabbing across
    // the shop cards must not end the turn by pressing Enter on a card).
    if (target && target !== document.body) {
      const tag = target.tagName;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(tag) || target.isContentEditable) return;
    }
    const cmd = classifyKey(e.key, e.code);
    if (!cmd) return;
    handlers.onKey(cmd);
    e.preventDefault();
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("keydown", key);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", cancel);
    canvas.removeEventListener("wheel", wheel);
    window.removeEventListener("keydown", key);
  };
}
