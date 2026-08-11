import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BLOCK_PX,
  MAX_SELECTION_BLOCKS,
  blocksIn,
  type BlockRect,
  type GridDims,
  type ZoomLevel,
} from "@/domain/geometry";
import {
  clampSelection,
  stepZoom,
  useGridPointer,
  type GridPointerOptions,
  type KeyLike,
  type PointerLike,
} from "@/components/grid/use-grid-pointer";

const DIMS: GridDims = { wBlocks: 400, hBlocks: 400 };

function domRect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height: width,
    right: width,
    bottom: width,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Client coordinates of the centre of a block, at zoom 1 and no downscale. */
function at(bx: number, by: number): PointerLike {
  return {
    clientX: bx * BLOCK_PX + 1.5,
    clientY: by * BLOCK_PX + 1.5,
    button: 0,
    shiftKey: false,
  };
}

function key(k: string, shiftKey = false): KeyLike {
  return { key: k, shiftKey, preventDefault: vi.fn() };
}

function setup(over: Partial<GridPointerOptions> = {}) {
  const onSelect = vi.fn<(rect: BlockRect | null) => void>();
  const onActivateBlock = vi.fn<(bx: number, by: number) => void>();
  const onZoomStep = vi.fn<(delta: 1 | -1) => void>();
  const taken = new Set<string>();

  const options: GridPointerOptions = {
    dims: DIMS,
    zoom: 1 as ZoomLevel,
    rectOf: () => domRect(1200),
    isAvailable: (bx, by) => !taken.has(`${bx},${by}`),
    onSelect,
    onActivateBlock,
    onZoomStep,
    ...over,
  };

  const view = renderHook((props: GridPointerOptions) => useGridPointer(props), {
    initialProps: options,
  });
  return { view, onSelect, onActivateBlock, onZoomStep, taken, options };
}

describe("useGridPointer — pointer selection", () => {
  it("treats a click as a 1x1 selection", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onPointerDown(at(4, 7)));
    act(() => view.result.current.onPointerUp(at(4, 7)));

    expect(onSelect).toHaveBeenLastCalledWith({ bx: 4, by: 7, bw: 1, bh: 1 });
    expect(view.result.current.dragging).toBe(false);
    expect(view.result.current.draft).toBeNull();
  });

  it("normalises a drag made in any direction, and snaps to whole blocks", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onPointerDown(at(10, 10)));
    // Land the pointer inside a block rather than on its corner: the selection
    // must still be whole blocks.
    act(() =>
      view.result.current.onPointerMove({
        clientX: 6 * BLOCK_PX + 2.7,
        clientY: 5 * BLOCK_PX + 0.1,
        button: 0,
        shiftKey: false,
      }),
    );
    act(() => view.result.current.onPointerUp(at(6, 5)));

    expect(onSelect).toHaveBeenLastCalledWith({ bx: 6, by: 5, bw: 5, bh: 6 });
  });

  it("reports the live rectangle while dragging", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onPointerDown(at(1, 1)));
    expect(view.result.current.dragging).toBe(true);
    expect(view.result.current.draft).toEqual({ bx: 1, by: 1, bw: 1, bh: 1 });

    act(() => view.result.current.onPointerMove(at(3, 2)));
    expect(view.result.current.draft).toEqual({ bx: 1, by: 1, bw: 3, bh: 2 });
    expect(onSelect).toHaveBeenLastCalledWith({ bx: 1, by: 1, bw: 3, bh: 2 });
  });

  it("tracks hover and forgets it when the pointer leaves", () => {
    const { view } = setup();

    act(() => view.result.current.onPointerMove(at(12, 9)));
    expect(view.result.current.hover).toEqual({ bx: 12, by: 9 });

    act(() => view.result.current.onPointerLeave());
    expect(view.result.current.hover).toBeNull();
  });

  it("finishes a drag released outside the grid", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onPointerDown(at(2, 2)));
    act(() => view.result.current.onPointerMove(at(4, 4)));
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });

    expect(view.result.current.dragging).toBe(false);
    expect(onSelect).toHaveBeenLastCalledWith({ bx: 2, by: 2, bw: 3, bh: 3 });
  });

  it("ignores a press that is not the primary button", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onPointerDown({ ...at(1, 1), button: 2 }));

    expect(view.result.current.dragging).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("useGridPointer — unavailable blocks", () => {
  it("allows the drag but exposes blocked when it overlaps an owned block", () => {
    const { view, onSelect, taken } = setup();
    taken.add("3,3");

    act(() => view.result.current.onPointerDown(at(2, 2)));
    act(() => view.result.current.onPointerMove(at(4, 4)));

    expect(view.result.current.blocked).toBe(true);
    expect(view.result.current.draft).toEqual({ bx: 2, by: 2, bw: 3, bh: 3 });
    expect(onSelect).toHaveBeenLastCalledWith({ bx: 2, by: 2, bw: 3, bh: 3 });

    act(() => view.result.current.onPointerMove(at(2, 2)));
    expect(view.result.current.blocked).toBe(false);
  });

  it("activates rather than selects when a single owned block is clicked", () => {
    const { view, onSelect, onActivateBlock, taken } = setup();
    taken.add("8,8");

    act(() => view.result.current.onPointerDown(at(8, 8)));
    act(() => view.result.current.onPointerUp(at(8, 8)));

    expect(onActivateBlock).toHaveBeenCalledWith(8, 8);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("never selects in read-only mode, but still opens a claim", () => {
    const { view, onSelect, onActivateBlock } = setup({ readOnly: true });

    act(() => view.result.current.onPointerDown(at(5, 5)));
    act(() => view.result.current.onPointerMove(at(9, 9)));
    act(() => view.result.current.onPointerUp(at(5, 5)));

    expect(onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ bw: 5 }));
    expect(onActivateBlock).toHaveBeenCalledWith(5, 5);
  });
});

describe("clampSelection", () => {
  it("leaves a rectangle inside the limit alone", () => {
    const { rect, clamped } = clampSelection({ bx: 0, by: 0 }, { bx: 9, by: 9 });
    expect(rect).toEqual({ bx: 0, by: 0, bw: 10, bh: 10 });
    expect(clamped).toBe(false);
  });

  it("clamps an oversized drag instead of dropping it, keeping the anchor corner", () => {
    const { rect, clamped } = clampSelection({ bx: 0, by: 0 }, { bx: 399, by: 399 });

    expect(clamped).toBe(true);
    expect(blocksIn(rect)).toBeLessThanOrEqual(MAX_SELECTION_BLOCKS);
    expect(rect.bx).toBe(0);
    expect(rect.by).toBe(0);
    // Aspect ratio survives, so the clamp reads as a limit rather than a glitch.
    expect(rect.bw).toBe(rect.bh);
  });

  it("clamps towards the anchor when the drag goes up and left", () => {
    const { rect, clamped } = clampSelection({ bx: 399, by: 399 }, { bx: 0, by: 0 });

    expect(clamped).toBe(true);
    expect(blocksIn(rect)).toBeLessThanOrEqual(MAX_SELECTION_BLOCKS);
    expect(rect.bx + rect.bw - 1).toBe(399);
    expect(rect.by + rect.bh - 1).toBe(399);
  });

  it("keeps a single-axis drag usable rather than collapsing it", () => {
    const { rect } = clampSelection({ bx: 0, by: 0 }, { bx: 399, by: 20 });

    expect(blocksIn(rect)).toBeLessThanOrEqual(MAX_SELECTION_BLOCKS);
    expect(rect.bw).toBeGreaterThan(rect.bh);
    expect(rect.bh).toBeGreaterThanOrEqual(1);
  });

  it("exposes the clamp through the hook so the UI can say so", () => {
    const { view } = setup();

    act(() => view.result.current.onPointerDown(at(0, 0)));
    act(() => view.result.current.onPointerMove(at(399, 399)));

    expect(view.result.current.clamped).toBe(true);
    expect(blocksIn(view.result.current.draft as BlockRect)).toBeLessThanOrEqual(
      MAX_SELECTION_BLOCKS,
    );

    act(() => view.result.current.onPointerMove(at(2, 2)));
    expect(view.result.current.clamped).toBe(false);
  });
});

describe("useGridPointer — keyboard", () => {
  it("moves a block cursor with the arrow keys, clamped to the grid", () => {
    const { view } = setup();

    act(() => view.result.current.onKeyDown(key("ArrowRight")));
    act(() => view.result.current.onKeyDown(key("ArrowDown")));
    expect(view.result.current.cursor).toEqual({ bx: 1, by: 1 });

    act(() => view.result.current.onKeyDown(key("ArrowUp")));
    act(() => view.result.current.onKeyDown(key("ArrowUp")));
    act(() => view.result.current.onKeyDown(key("ArrowLeft")));
    act(() => view.result.current.onKeyDown(key("ArrowLeft")));
    expect(view.result.current.cursor).toEqual({ bx: 0, by: 0 });
  });

  it("extends the selection with shift and an arrow", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onKeyDown(key("ArrowRight")));
    act(() => view.result.current.onKeyDown(key("ArrowRight", true)));
    act(() => view.result.current.onKeyDown(key("ArrowDown", true)));

    expect(onSelect).toHaveBeenLastCalledWith({ bx: 1, by: 0, bw: 2, bh: 2 });
    expect(view.result.current.draft).toEqual({ bx: 1, by: 0, bw: 2, bh: 2 });
  });

  it("confirms with Enter", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onKeyDown(key("ArrowDown")));
    act(() => view.result.current.onKeyDown(key("Enter")));

    expect(onSelect).toHaveBeenLastCalledWith({ bx: 0, by: 1, bw: 1, bh: 1 });
  });

  it("opens the claim under the cursor when Enter lands on an owned block", () => {
    const { view, onActivateBlock, taken } = setup();
    taken.add("0,1");

    act(() => view.result.current.onKeyDown(key("ArrowDown")));
    act(() => view.result.current.onKeyDown(key("Enter")));

    expect(onActivateBlock).toHaveBeenCalledWith(0, 1);
  });

  it("cancels with Escape", () => {
    const { view, onSelect } = setup();

    act(() => view.result.current.onPointerDown(at(3, 3)));
    act(() => view.result.current.onPointerMove(at(6, 6)));
    act(() => view.result.current.onKeyDown(key("Escape")));

    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(view.result.current.draft).toBeNull();
    expect(view.result.current.dragging).toBe(false);
  });

  it("steps zoom on plus and minus, including their unshifted faces", () => {
    const { view, onZoomStep } = setup();

    act(() => view.result.current.onKeyDown(key("+")));
    act(() => view.result.current.onKeyDown(key("=")));
    act(() => view.result.current.onKeyDown(key("-")));
    act(() => view.result.current.onKeyDown(key("_")));

    expect(onZoomStep.mock.calls).toEqual([[1], [1], [-1], [-1]]);
  });

  it("does not extend a selection in read-only mode", () => {
    const { view, onSelect } = setup({ readOnly: true });

    act(() => view.result.current.onKeyDown(key("ArrowRight", true)));

    expect(onSelect).not.toHaveBeenCalled();
    expect(view.result.current.cursor).toEqual({ bx: 1, by: 0 });
  });
});

describe("useGridPointer — zoom and downscale", () => {
  it("hits the same block whatever the zoom, because the rect grows with it", () => {
    for (const zoom of [1, 2, 4] as const) {
      const { view, onSelect } = setup({
        zoom,
        rectOf: () => domRect(1200 * zoom),
      });

      const press: PointerLike = {
        clientX: (17 * BLOCK_PX + 1.5) * zoom,
        clientY: (23 * BLOCK_PX + 1.5) * zoom,
        button: 0,
        shiftKey: false,
      };
      act(() => view.result.current.onPointerDown(press));
      act(() => view.result.current.onPointerUp(press));

      expect(onSelect).toHaveBeenLastCalledWith({ bx: 17, by: 23, bw: 1, bh: 1 });
    }
  });

  it("selects the block under the finger on a downscaled phone canvas", () => {
    const scale = 390 / 1200;
    const { view, onSelect } = setup({ rectOf: () => domRect(390) });

    const press: PointerLike = {
      clientX: (200 * BLOCK_PX + 1.5) * scale,
      clientY: (150 * BLOCK_PX + 1.5) * scale,
      button: 0,
      shiftKey: false,
    };
    act(() => view.result.current.onPointerDown(press));
    act(() => view.result.current.onPointerUp(press));

    expect(onSelect).toHaveBeenLastCalledWith({ bx: 200, by: 150, bw: 1, bh: 1 });
  });

  it("does nothing when the element has gone", () => {
    const { view, onSelect } = setup({ rectOf: () => null });

    act(() => view.result.current.onPointerDown(at(1, 1)));

    expect(view.result.current.dragging).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("stepZoom", () => {
  it("walks the allowed levels and saturates at both ends", () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(2, 1)).toBe(4);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(1, -1)).toBe(1);
    expect(stepZoom(4, -1)).toBe(2);
  });
});
