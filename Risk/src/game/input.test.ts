/** Pointer, wheel, pinch and the keyboard map (SPEC §9). */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCamera, type Camera } from "@/render/camera";

import { DRAG_SLOP, KEY_PAN_PX, createInput, territoryAtPoint } from "./input";

/**
 * jsdom has no layout engine and therefore no `elementFromPoint`, so the hit
 * test is stubbed rather than spied. That is honest: the real picking is the
 * browser's, and what this suite proves is the tap/drag/pinch logic above it.
 */
function stubElement(node: Element | null): void {
  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => node;
}

function stubElementFromPoint(index: number | null): void {
  const node = index === null ? null : (() => {
    const el = document.createElement("div");
    el.setAttribute("data-territory", String(index));
    document.body.appendChild(el);
    return el;
  })();
  stubElement(node);
}

function pointer(type: string, id: number, x: number, y: number): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: id },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}

describe("territoryAtPoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("reads the data-territory attribute under the point", () => {
    stubElementFromPoint(7);
    expect(territoryAtPoint(10, 10)).toBe(7);
  });

  it("returns null over open water", () => {
    stubElementFromPoint(null);
    expect(territoryAtPoint(10, 10)).toBeNull();
  });

  it("walks up from a child of the path", () => {
    const parent = document.createElement("g");
    parent.setAttribute("data-territory", "3");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);
    stubElement(child);
    expect(territoryAtPoint(0, 0)).toBe(3);
  });

  it("ignores a non-numeric attribute", () => {
    const el = document.createElement("div");
    el.setAttribute("data-territory", "nope");
    document.body.appendChild(el);
    stubElement(el);
    expect(territoryAtPoint(0, 0)).toBeNull();
  });
});

describe("createInput", () => {
  let cam: Camera;
  let taps: number[];
  let aways: number;
  let element: HTMLElement;
  let detach: () => void;

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    // Wider than the viewport's aspect at cover scale, so there is pan room
    // to prove a drag with — a board that exactly covers cannot pan at all.
    cam = createCamera({ board: { w: 2400, h: 900 }, viewport: { w: 800, h: 450 } });
    taps = [];
    aways = 0;
    element = document.createElement("div");
    document.body.appendChild(element);
    const input = createInput({
      camera: () => cam,
      setCamera: (next) => { cam = next; },
      onTap: (t) => taps.push(t),
      onTapAway: () => { aways += 1; },
    });
    detach = input.attach(element);
  });

  it("a press and release within the slop is a tap", () => {
    stubElementFromPoint(2);
    element.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    element.dispatchEvent(pointer("pointerup", 1, 100 + DRAG_SLOP - 1, 100));
    expect(taps).toEqual([2]);
    detach();
  });

  it("a drag beyond the slop is a pan, not a tap", () => {
    stubElementFromPoint(2);
    const before = cam.pan;
    element.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    element.dispatchEvent(pointer("pointermove", 1, 160, 100));
    element.dispatchEvent(pointer("pointerup", 1, 160, 100));
    expect(taps).toEqual([]);
    expect(cam.pan).not.toEqual(before);
    detach();
  });

  it("a tap on open water reports no territory", () => {
    stubElementFromPoint(null);
    element.dispatchEvent(pointer("pointerdown", 1, 10, 10));
    element.dispatchEvent(pointer("pointerup", 1, 10, 10));
    expect(taps).toEqual([]);
    expect(aways).toBe(1);
    detach();
  });

  it("two pointers pinch the zoom", () => {
    const before = cam.zoom;
    element.dispatchEvent(pointer("pointerdown", 1, 300, 200));
    element.dispatchEvent(pointer("pointerdown", 2, 400, 200));
    element.dispatchEvent(pointer("pointermove", 2, 600, 200));
    expect(cam.zoom).toBeGreaterThan(before);
    detach();
  });

  it("the wheel zooms about the cursor", () => {
    const before = cam.zoom;
    const wheel = new Event("wheel", { bubbles: true, cancelable: true }) as WheelEvent;
    Object.defineProperties(wheel, {
      deltaY: { value: -120 }, clientX: { value: 400 }, clientY: { value: 225 },
    });
    element.dispatchEvent(wheel);
    expect(cam.zoom).toBeGreaterThan(before);
    detach();
  });

  it("never zooms below the cover scale", () => {
    for (let i = 0; i < 20; i += 1) {
      const wheel = new Event("wheel", { bubbles: true, cancelable: true }) as WheelEvent;
      Object.defineProperties(wheel, {
        deltaY: { value: 120 }, clientX: { value: 400 }, clientY: { value: 225 },
      });
      element.dispatchEvent(wheel);
    }
    expect(cam.zoom).toBeCloseTo(0.5, 6); // 800/1600 === 450/900
    detach();
  });

  it("detaching stops listening", () => {
    stubElementFromPoint(2);
    detach();
    element.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    element.dispatchEvent(pointer("pointerup", 1, 100, 100));
    expect(taps).toEqual([]);
  });
});

describe("the keyboard map (§9)", () => {
  it("arrows and WASD pan, + and - zoom, and an unknown key is not consumed", () => {
    let cam = createCamera({ board: { w: 2400, h: 1400 }, viewport: { w: 800, h: 450 } });
    const input = createInput({
      camera: () => cam,
      setCamera: (next) => { cam = next; },
      onTap: () => {},
    });
    const startX = cam.pan[0];
    expect(input.handleKey("ArrowLeft")).toBe(true);
    expect(cam.pan[0]).toBeCloseTo(Math.min(0, startX + KEY_PAN_PX), 6);
    expect(input.handleKey("w")).toBe(true);
    const zoomBefore = cam.zoom;
    expect(input.handleKey("+")).toBe(true);
    expect(cam.zoom).toBeGreaterThan(zoomBefore);
    expect(input.handleKey("-")).toBe(true);
    expect(input.handleKey("q")).toBe(false);
    input.destroy();
  });
});
