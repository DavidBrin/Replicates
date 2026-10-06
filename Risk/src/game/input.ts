/**
 * Pointer → `TerritoryId`, drag, wheel and pinch (SPEC §9).
 *
 * Touch and mouse share one path. A pointer event hit-tests the SVG to a
 * territory (`document.elementFromPoint` on the `.territory` paths), and the
 * point is taken back to map units by **`camera.toMap`** — the single
 * projection of §8's coordinate contract. Nothing here writes a second
 * inverse transform.
 *
 * A drag beyond `DRAG_SLOP` px becomes a pan rather than a tap; pinch and
 * wheel both change one `camera.zoom`; pan is clamped and minimum zoom is the
 * cover scale, so the board always covers the viewport.
 */
import type { TerritoryId } from "@/engine/types";

import { type Camera, panBy, toMap, zoomAt } from "@/render/camera";

/** Past this many pixels of movement a press is a pan, not a tap. */
export const DRAG_SLOP = 8;
/** One wheel notch. */
export const WHEEL_STEP = 1.12;
/** The keyboard pan step (§9's arrows / WASD). */
export const KEY_PAN_PX = 60;

export interface InputHandlers {
  /** The camera to read, always the live one. */
  camera(): Camera;
  setCamera(next: Camera): void;
  /** A tap that did not turn into a pan. */
  onTap(territory: TerritoryId, at: readonly [number, number]): void;
  /** A tap on open water. */
  onTapAway?(): void;
}

export interface InputHandle {
  attach(element: HTMLElement): () => void;
  /** Exposed so a test can drive the same logic without real pointer events. */
  hitTest(clientX: number, clientY: number, doc?: Document): TerritoryId | null;
  /** The §9 keyboard map. Returns true when the key was consumed. */
  handleKey(key: string): boolean;
  destroy(): void;
}

/**
 * The territory under a client point, or null.
 *
 * `elementFromPoint` is the hit test, not a geometry calculation: the SVG
 * paths already carry the camera's transforms, so the browser's own picking
 * is both correct under `rotateX` and far cheaper than re-projecting 42
 * polygons. `closest` walks up from whatever child was hit.
 */
export function territoryAtPoint(
  clientX: number, clientY: number, doc: Document = document,
): TerritoryId | null {
  const element = doc.elementFromPoint(clientX, clientY);
  if (!element) return null;
  const path = element.closest?.("[data-territory]") ?? null;
  if (!path) return null;
  const raw = path.getAttribute("data-territory");
  if (raw === null) return null;
  const index = Number(raw);
  return Number.isInteger(index) ? index : null;
}

interface Pointer {
  readonly id: number;
  x: number;
  y: number;
  readonly startX: number;
  readonly startY: number;
}

export function createInput(handlers: InputHandlers): InputHandle {
  const pointers = new Map<number, Pointer>();
  let dragging = false;
  let pinchDistance = 0;
  let detach: (() => void) | null = null;

  const centre = (): readonly [number, number] => {
    const list = [...pointers.values()];
    if (list.length === 0) return [0, 0];
    const sx = list.reduce((n, p) => n + p.x, 0) / list.length;
    const sy = list.reduce((n, p) => n + p.y, 0) / list.length;
    return [sx, sy];
  };

  const spread = (): number => {
    const list = [...pointers.values()];
    const a = list[0];
    const b = list[1];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function onPointerDown(event: PointerEvent): void {
    pointers.set(event.pointerId, {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
    });
    if (pointers.size === 2) pinchDistance = spread();
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (pointers.size >= 2) {
      const next = spread();
      if (pinchDistance > 0 && next > 0) {
        handlers.setCamera(zoomAt(handlers.camera(), next / pinchDistance, centre()));
      }
      pinchDistance = next;
      dragging = true;
      return;
    }

    const moved = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    if (!dragging && moved <= DRAG_SLOP) return;
    dragging = true;
    handlers.setCamera(panBy(handlers.camera(), dx, dy));
  }

  function onPointerUp(event: PointerEvent): void {
    const pointer = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (!pointer) return;
    const moved = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    const wasDrag = dragging || moved > DRAG_SLOP;
    if (pointers.size === 0) dragging = false;
    if (wasDrag) return;
    const territory = territoryAtPoint(event.clientX, event.clientY);
    if (territory === null) {
      handlers.onTapAway?.();
      return;
    }
    handlers.onTap(territory, toMap(handlers.camera(), [event.clientX, event.clientY]));
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    handlers.setCamera(zoomAt(handlers.camera(), factor, [event.clientX, event.clientY]));
  }

  function handleKey(key: string): boolean {
    const cam = handlers.camera();
    const view = cam.viewport ?? { w: 0, h: 0 };
    const mid: readonly [number, number] = [view.w / 2, view.h / 2];
    switch (key) {
      case "ArrowLeft": case "a": case "A":
        handlers.setCamera(panBy(cam, KEY_PAN_PX, 0));
        return true;
      case "ArrowRight": case "d": case "D":
        handlers.setCamera(panBy(cam, -KEY_PAN_PX, 0));
        return true;
      case "ArrowUp": case "w": case "W":
        handlers.setCamera(panBy(cam, 0, KEY_PAN_PX));
        return true;
      case "ArrowDown": case "s": case "S":
        handlers.setCamera(panBy(cam, 0, -KEY_PAN_PX));
        return true;
      case "+": case "=":
        handlers.setCamera(zoomAt(cam, WHEEL_STEP, mid));
        return true;
      case "-": case "_":
        handlers.setCamera(zoomAt(cam, 1 / WHEEL_STEP, mid));
        return true;
      default:
        return false;
    }
  }

  return {
    attach(element: HTMLElement) {
      const down = onPointerDown as EventListener;
      const move = onPointerMove as EventListener;
      const up = onPointerUp as EventListener;
      const wheel = onWheel as EventListener;
      element.addEventListener("pointerdown", down);
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", up);
      element.addEventListener("wheel", wheel, { passive: false });
      detach = () => {
        element.removeEventListener("pointerdown", down);
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", up);
        element.removeEventListener("wheel", wheel);
      };
      return detach;
    },
    hitTest: (x, y, doc) => territoryAtPoint(x, y, doc),
    handleKey,
    destroy() {
      detach?.();
      detach = null;
      pointers.clear();
    },
  };
}
