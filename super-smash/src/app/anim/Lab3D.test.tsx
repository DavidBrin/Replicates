/**
 * The lab's model sheet (Plan 4, Task 21): the fighter's model posed by the
 * match's own `drawnPose`, one cell per frame at the action's true length, with
 * the boxes the sim plays drawn over each cell (red hitboxes, yellow hurtboxes).
 *
 * The boxes are tested against the independent readers the game has for them (the
 * `MoveDef` table the CPU and the renderer read, `fighterHurtboxes`), never
 * against the function under test; the sheet is tested through a recording
 * stand-in for the WebGL renderer, because jsdom has no GL.
 */

import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { fighterHurtboxes } from "@/engine/acmd/hurtboxes";
import { toFloat } from "@/engine/fixed";
import { activeHitboxes, type Capsule } from "@/engine/hitbox";
import type { FighterState } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { createMockContext, type MockContext } from "@/render/mockContext";
import { drawnPose } from "@/render3d/fighterPose";
import { boxExtent, CELL, COLUMNS, Lab3D, labBoxes, modelExtent, sheetView } from "./Lab3D";
import { fighterAt, type Options } from "./page";

/* ------------------------------------------------------------------ fakes -- */

/** A recording WebGLRenderer: jsdom has no GL, and what matters here is what the sheet asks of it. */
const gl = vi.hoisted(() => {
  interface Draw {
    viewport: number[];
    scissor: number[];
    scissorTest: boolean;
    /** What each fighter placement in the scene holds as it is drawn: an emptied one is a disposed fighter. */
    fighters: number[];
  }
  class FakeGL {
    static all: FakeGL[] = [];
    readonly domElement: HTMLCanvasElement;
    toneMapping = 0;
    outputColorSpace = "";
    viewport = [0, 0, 0, 0];
    scissor = [0, 0, 0, 0];
    scissorTest = false;
    sizes: number[][] = [];
    draws: Draw[] = [];
    disposed = 0;
    constructor(params: { canvas: HTMLCanvasElement }) {
      this.domElement = params.canvas;
      FakeGL.all.push(this);
    }
    setPixelRatio(): void {}
    setClearColor(): void {}
    setSize(w: number, h: number, updateStyle: boolean): void {
      this.sizes.push([w, h, updateStyle ? 1 : 0]);
      this.domElement.width = w;
      this.domElement.height = h;
    }
    setScissorTest(on: boolean): void {
      this.scissorTest = on;
    }
    setViewport(x: number, y: number, w: number, h: number): void {
      this.viewport = [x, y, w, h];
    }
    setScissor(x: number, y: number, w: number, h: number): void {
      this.scissor = [x, y, w, h];
    }
    render(scene: { children: { name: string; children: unknown[] }[] }): void {
      const fighters = scene.children.filter((c) => c.name.startsWith("fighter:")).map((c) => c.children.length);
      this.draws.push({ viewport: [...this.viewport], scissor: [...this.scissor], scissorTest: this.scissorTest, fighters });
    }
    dispose(): void {
      this.disposed += 1;
    }
  }
  return { FakeGL };
});

vi.mock("three", async (importOriginal) => ({ ...(await importOriginal<typeof import("three")>()), WebGLRenderer: gl.FakeGL }));

/** The bake, as the page's `useBake` hands it over once installed. */
const bakeState = vi.hoisted(() => ({ tables: null as BakeTables | null, error: null as string | null }));
vi.mock("@/game/useBake", () => ({ useBake: () => bakeState }));

/** No network: every fighter is a stand-in (its own hurtbox capsules on the same bones). */
vi.mock("@/game/world3d", () => ({
  sharedModels: () => ({
    get: async () => ({ kind: "standIn", reason: "test" }),
    preload: async () => undefined,
    status: () => ({}),
  }),
}));

/** The match's pose function, called through: the sheet must reach this very one. */
vi.mock("@/render3d/fighterPose", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/render3d/fighterPose")>();
  return { ...real, drawnPose: vi.fn(real.drawnPose) };
});

const bake = readBakeFromDisk();
const byId = (id: string) => FIGHTERS.find((d) => d.id === id)!;
/** The game's fighters: limb-bone scripts on, placed through the bake (ruling R1), as the match and the bake have them. */
const game = (id: string) => withLimbScripts(byId(id), bake.bones);

const opts = (over: Partial<Options> = {}): Options => ({
  fighterId: "mario",
  action: "attack",
  move: "ftilt",
  jumpsUsed: 0,
  fastFalling: false,
  ...over,
});

const FTILT_FRAMES = 25;

/** What the sheet is shown as: a fighter at the origin facing forward on cell `i`. */
const cell = (o: Options, i: number): FighterState => ({ ...fighterAt(o, i), x: 0, y: 0, facing: 1 });

/** A hitbox the way the game's table holds it, as the lab draws it. */
const asCapsule = (h: { x: number; y: number; x2?: number; y2?: number; radius: number }): Capsule => ({
  x1: h.x,
  y1: h.y,
  x2: h.x2 ?? h.x,
  y2: h.y2 ?? h.y,
  r: h.radius,
});

/* --------------------------------------------------------------- the boxes -- */

describe("the boxes the sheet draws", () => {
  it("are Mario's forward tilt as the game plays it: three hitboxes on move frames 5 to 7, none before or after", () => {
    // Active 5-7, first actionable frame 26 (so 25 frames): https://ultimateframedata.com/mario
    const o = opts();
    for (let i = 0; i < FTILT_FRAMES; i++) {
      const { hit } = labBoxes(o, cell(o, i), i, bake);
      expect(hit, `cell ${i}`).toHaveLength(i >= 4 && i <= 6 ? 3 : 0);
    }
  });

  it("match the game's own move table frame for frame (the table the CPU's reach and the renderer's swing read)", () => {
    // Cell i is `actionFrame` i, which is move frame i + 1 (`moveFrameOf`).
    const move = game("mario").moves.ftilt!;
    const o = opts();
    for (let i = 0; i < FTILT_FRAMES; i++) {
      const want = activeHitboxes(move, i + 1).map(asCapsule);
      expect(labBoxes(o, cell(o, i), i, bake).hit, `cell ${i}`).toEqual(want);
    }
  });

  it("come from the limb-bone script, not the legacy table (the forward tilt's first box moved)", () => {
    const o = opts();
    const lab = labBoxes(o, cell(o, 4), 4, bake).hit[0];
    const legacy = activeHitboxes(byId("mario").moves.ftilt!, 5)[0];
    expect(lab.x1).not.toBe(legacy.x);
    // Mario's lead hand, a few units out in front (the limb table, `limb.json`): https://ultimateframedata.com/mario
    expect(toFloat(lab.x1)).toBeGreaterThan(5);
  });

  it("are facing-relative: a forward attack's furthest box is out in front, at +x", () => {
    const o = opts();
    const reach = Math.max(...labBoxes(o, cell(o, 5), 5, bake).hit.map((h) => toFloat(h.x1)));
    expect(reach).toBeGreaterThan(5);
  });

  it("show no hitbox for an action that performs no move, though the lab's fighter carries the dropdown's move", () => {
    // `fighterAt` always sets `move`, as the dropdown has one; the sim only reads it while an attacking status runs.
    for (const action of ["stand", "land", "jump", "shield", "hitstun"] as const) {
      const o = opts({ action, move: "fsmash" });
      for (let i = 0; i < 12; i++) expect(labBoxes(o, cell(o, i), i, bake).hit, `${action} ${i}`).toEqual([]);
    }
  });

  it("include a grab's catch boxes", () => {
    const o = opts({ action: "grab", move: "grab" });
    let live = 0;
    for (let i = 0; i < 40; i++) live += labBoxes(o, cell(o, i), i, bake).hit.length;
    expect(live).toBeGreaterThan(0);
  });

  it("put the hurtboxes where the sim does: the bake's, at the origin facing forward", () => {
    for (const [fighterId, action, move] of [
      ["mario", "attack", "ftilt"],
      ["mario", "stand", "fsmash"],
      ["kirby", "jump", "fsmash"],
      ["marth", "attack", "fsmash"],
    ] as const) {
      const o = opts({ fighterId, action, move });
      for (const i of [0, 3, 9]) {
        const f = cell(o, i);
        expect(labBoxes(o, f, i, bake).hurt, `${fighterId} ${action} ${i}`).toEqual(fighterHurtboxes(game(fighterId), f, i, bake));
      }
    }
  });

  it("move with the clip: a swing carries the hurtboxes forward", () => {
    const o = opts();
    const at = (i: number) => labBoxes(o, cell(o, i), i, bake).hurt;
    expect(at(0)).not.toEqual(at(5));
    expect(at(5).length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- framing -- */

const sheetOf = (o: Options, total: number) => Array.from({ length: total }, (_, i) => labBoxes(o, cell(o, i), i, bake));
const extentsOf = (boxes: ReturnType<typeof sheetOf>) => boxes.map(boxExtent);

describe("the sheet's framing", () => {
  it("is never tighter than 22 world units, so a small fighter is not blown up", () => {
    expect(sheetView(extentsOf(sheetOf(opts({ fighterId: "kirby", action: "stand" }), 20))).size).toBe(22);
  });

  it("holds every box of every cell, for every fighter (Donkey Kong stands 26 units tall)", () => {
    for (const def of FIGHTERS) {
      for (const [action, move, total] of [["stand", "jab1", 20], ["attack", "ftilt", def.moves.ftilt!.totalFrames], ["attack", "fsmash", def.moves.fsmash!.totalFrames]] as const) {
        const o = opts({ fighterId: def.id, action, move });
        const extents = extentsOf(sheetOf(o, total));
        const v = sheetView(extents);
        const half = v.size / 2;
        for (const e of extents) {
          expect(e, `${def.id} ${action} ${move}`).not.toBeNull();
          expect(v.x - half, `${def.id} ${action} ${move} left`).toBeLessThanOrEqual(e!.minX);
          expect(v.x + half, `${def.id} ${action} ${move} right`).toBeGreaterThanOrEqual(e!.maxX);
          expect(v.y - half, `${def.id} ${action} ${move} bottom`).toBeLessThanOrEqual(e!.minY);
          expect(v.y + half, `${def.id} ${action} ${move} top`).toBeGreaterThanOrEqual(e!.maxY);
        }
      }
    }
    // The case the fixed 22-unit window of the plan's first sketch cut off.
    expect(sheetView(extentsOf(sheetOf(opts({ fighterId: "donkeyKong", action: "stand" }), 20))).size).toBeGreaterThan(26.3);
  });

  it("is one window for the whole sheet: the same fighter at the same scale in every cell", () => {
    const o = opts();
    expect(sheetView(extentsOf(sheetOf(o, FTILT_FRAMES)))).toEqual(sheetView(extentsOf(sheetOf(o, FTILT_FRAMES))));
  });

  it("holds the model too, not only the boxes: a tail or a blade is no hurtbox", () => {
    const o = opts({ fighterId: "mario", action: "stand" });
    const boxes = extentsOf(sheetOf(o, 20));
    // A part of the model 40 units out to the side, as Fox's tail or Link's blade stand out of their hurtboxes.
    const tail = new Group();
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    mesh.position.set(-40, 10, 0);
    tail.add(mesh);
    tail.updateMatrixWorld(true);
    expect(modelExtent(tail)).toEqual({ minX: -41, maxX: -39, minY: 9, maxY: 11 });
    const without = sheetView(boxes);
    const withTail = sheetView([...boxes, modelExtent(tail)]);
    expect(withTail.size).toBeGreaterThan(without.size);
    expect(withTail.x - withTail.size / 2).toBeLessThanOrEqual(-41);
  });

  it("measures a model that draws nothing as no extent", () => {
    expect(modelExtent(new Group())).toBeNull();
  });
});

/* ------------------------------------------------------------- the sheet -- */

let ctx: MockContext;

beforeEach(() => {
  gl.FakeGL.all.length = 0;
  bakeState.tables = bake;
  bakeState.error = null;
  vi.mocked(drawnPose).mockClear();
  ctx = createMockContext(CELL, CELL);
  // jsdom has no 2D canvas either.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every capsule stroked on the overlay: its colour and the circle centres it was built from. */
function strokes(c: MockContext): { colour: string; arcs: { x: number; y: number }[] }[] {
  const out: { colour: string; arcs: { x: number; y: number }[] }[] = [];
  let colour = "";
  let arcs: { x: number; y: number }[] = [];
  for (const call of c.calls) {
    if (call.method === "set:strokeStyle") colour = String(call.args[0]);
    else if (call.method === "beginPath") arcs = [];
    else if (call.method === "arc") arcs.push({ x: Number(call.args[0]), y: Number(call.args[1]) });
    else if (call.method === "stroke") out.push({ colour, arcs });
  }
  return out;
}

const RED = "rgba(255,60,60,0.95)";
const YELLOW = "rgba(255,214,0,0.8)";

describe("Lab3D", () => {
  it("draws one cell per frame through ONE renderer, each through its own scissor rectangle", async () => {
    render(<Lab3D options={opts()} total={FTILT_FRAMES} frame={4} />);
    await waitFor(() => expect(gl.FakeGL.all[0]?.draws).toHaveLength(FTILT_FRAMES));

    expect(gl.FakeGL.all).toHaveLength(1);
    const r = gl.FakeGL.all[0];
    // 25 cells in 12 columns: three rows, the canvas sized to the grid and never styled by three.
    expect(r.sizes.at(-1)).toEqual([COLUMNS * CELL, 3 * CELL, 0]);
    r.draws.forEach((d, i) => {
      const x = (i % COLUMNS) * CELL;
      // WebGL counts from the bottom edge.
      const y = 3 * CELL - (Math.floor(i / COLUMNS) + 1) * CELL;
      expect(d.viewport, `cell ${i}`).toEqual([x, y, CELL, CELL]);
      expect(d.scissor, `cell ${i}`).toEqual([x, y, CELL, CELL]);
      expect(d.scissorTest).toBe(true);
    });
  });

  it("poses every cell through the match's own drawnPose, on the game's fighter and the installed bake", async () => {
    render(<Lab3D options={opts()} total={FTILT_FRAMES} frame={0} />);
    await waitFor(() => expect(gl.FakeGL.all[0]?.draws).toHaveLength(FTILT_FRAMES));

    // Twice a cell: once to measure the model for the window, once to draw it.
    const calls = vi.mocked(drawnPose).mock.calls;
    expect(calls).toHaveLength(2 * FTILT_FRAMES);
    expect(new Set(calls.map((c) => c[2]))).toEqual(new Set(Array.from({ length: FTILT_FRAMES }, (_, i) => i)));
    for (const [inputs, f, frame, blends] of calls) {
      // Cell i is the fighter on `actionFrame` i, with the match's clock at frame i and no fade (the bake's own pose).
      expect(f.actionFrame).toBe(frame);
      expect(f.action).toBe("attack");
      expect(f.move).toBe("ftilt");
      expect(blends).toBeNull();
      // The game's fighter (limb scripts placed through this bake): the def the sim, the bake and the match use.
      expect(inputs.def).toBe(game("mario"));
      expect(inputs.bake).toBe(bake);
    }
  });

  it("draws the hitboxes red on the frames they are live, the hurtboxes yellow on every frame, each inside its own cell", async () => {
    render(<Lab3D options={opts()} total={FTILT_FRAMES} frame={4} />);
    await waitFor(() => expect(gl.FakeGL.all[0]?.draws).toHaveLength(FTILT_FRAMES));

    const o = opts();
    const boxes = sheetOf(o, FTILT_FRAMES);
    const drawn = strokes(ctx);
    const red = drawn.filter((s) => s.colour === RED);
    const yellow = drawn.filter((s) => s.colour === YELLOW);
    expect(red).toHaveLength(boxes.reduce((n, b) => n + b.hit.length, 0));
    expect(red).toHaveLength(9);
    expect(yellow).toHaveLength(boxes.reduce((n, b) => n + b.hurt.length, 0));
    // A capsule is two circles: the near and the far end.
    for (const s of drawn) expect(s.arcs).toHaveLength(2);
    // Nothing spills into another cell: the sheet is 12 cells wide and 3 high.
    for (const s of drawn) {
      for (const a of s.arcs) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThanOrEqual(COLUMNS * CELL);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeLessThanOrEqual(3 * CELL);
      }
    }
  });

  it("says what it is drawing and marks the sheet drawn once every cell is", async () => {
    const { getByLabelText, findByText } = render(<Lab3D options={opts()} total={FTILT_FRAMES} frame={4} />);
    await findByText(/model sheet — stand-in \(test\)/);
    await waitFor(() => expect(getByLabelText("Model sheet")).toHaveAttribute("data-drawn", "true"));
  });

  it("makes no second renderer for a new action or fighter, and frees the one it has on unmount", async () => {
    const { rerender, unmount } = render(<Lab3D options={opts()} total={FTILT_FRAMES} frame={0} />);
    await waitFor(() => expect(gl.FakeGL.all[0]?.draws).toHaveLength(FTILT_FRAMES));

    rerender(<Lab3D options={opts({ action: "stand", move: "fsmash" })} total={40} frame={0} />);
    await waitFor(() => expect(gl.FakeGL.all[0].draws).toHaveLength(FTILT_FRAMES + 40));
    rerender(<Lab3D options={opts({ fighterId: "kirby", action: "stand", move: "fsmash" })} total={40} frame={0} />);
    await waitFor(() => expect(gl.FakeGL.all[0].draws).toHaveLength(FTILT_FRAMES + 80));

    expect(gl.FakeGL.all).toHaveLength(1);
    expect(gl.FakeGL.all[0].disposed).toBe(0);
    // 40 cells: 12 across, four down.
    expect(gl.FakeGL.all[0].sizes.at(-1)).toEqual([COLUMNS * CELL, 4 * CELL, 0]);
    unmount();
    expect(gl.FakeGL.all[0].disposed).toBe(1);
  });

  it("never draws a fighter it has already disposed: back to a fighter before the other's model is in", async () => {
    const { rerender } = render(<Lab3D options={opts()} total={FTILT_FRAMES} frame={0} />);
    await waitFor(() => expect(gl.FakeGL.all[0]?.draws).toHaveLength(FTILT_FRAMES));

    // Kirby, then straight back to Mario while Kirby's model is still loading: Mario is built afresh, and the one
    // that was disposed on the way out must not be drawn in the meantime.
    rerender(<Lab3D options={opts({ fighterId: "kirby" })} total={FTILT_FRAMES} frame={0} />);
    rerender(<Lab3D options={opts({ fighterId: "mario", action: "stand", move: "fsmash" })} total={20} frame={0} />);
    await waitFor(() => expect(gl.FakeGL.all[0].draws.length).toBeGreaterThan(FTILT_FRAMES));
    await waitFor(() => expect(gl.FakeGL.all[0].draws.at(-1)?.fighters).toEqual([expect.any(Number)]));

    for (const d of gl.FakeGL.all[0].draws) expect(d.fighters.every((n) => n > 0)).toBe(true);
  });

  it("leaks no renderer under React's development double mount", async () => {
    const { unmount } = render(
      <StrictMode>
        <Lab3D options={opts()} total={FTILT_FRAMES} frame={0} />
      </StrictMode>,
    );
    await waitFor(() => expect(gl.FakeGL.all.at(-1)?.draws).toHaveLength(FTILT_FRAMES));
    unmount();
    expect(gl.FakeGL.all.length).toBeGreaterThanOrEqual(1);
    for (const r of gl.FakeGL.all) expect(r.disposed).toBe(1);
  });

  it("draws nothing, and says why, when the bake did not load", async () => {
    bakeState.tables = null;
    bakeState.error = "Could not load the fighters' animation data (HTTP 404).";
    const { findByText } = render(<Lab3D options={opts()} total={FTILT_FRAMES} frame={0} />);
    await findByText(/Could not load the fighters' animation data \(HTTP 404\)\./);
    expect(gl.FakeGL.all.flatMap((r) => r.draws)).toEqual([]);
  });
});
