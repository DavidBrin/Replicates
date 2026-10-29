import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Vector3, type Camera as ThreeCamera, type Object3D, type PerspectiveCamera } from "three";

import { toFloat } from "@/engine/fixed";
import type { FighterState, MatchRules } from "@/engine/types";
import { LoopbackNetwork } from "@/net/adapters/loopback";
import { createNullTransport } from "@/net/transport";
import { VIEW_HEIGHT, VIEW_WIDTH, createCamera } from "@/render/camera";
import * as characterArt from "@/render/characterArt";
import { createMockContext } from "@/render/mockContext";
import { INTERPOLATION_SNAP_UNITS, interpolatePosition, type RenderState } from "@/render/renderer";
import { overlayAnchor } from "@/render3d/anchors";
import { createModelCache } from "@/render3d/models/loader";
import { createRenderer3D, type GLLike } from "@/render3d/renderer3d";
import { SKELETONS } from "@/render3d/skeletons";
import { installBake } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
import { GAME_SIM_CONTEXT } from "./simContext";
import { FRAME_MS, createMatchRunner, type WorldPresenter } from "./matchRunner";

// The real tag painter, watched: where the overlay hangs each port's tag.
vi.mock("@/render/characterArt", async (orig) => {
  const real = await orig<typeof import("@/render/characterArt")>();
  return { ...real, drawPortTag: vi.fn(real.drawPortTag) };
});

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 60 * 60 * 7, smashBall: false, oneOnOne: true };

function canvasWith(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1920;
  c.height = 1080;
  vi.spyOn(c, "getContext").mockReturnValue(ctx as never);
  return c;
}

beforeAll(() => bootstrapEngine());
afterEach(() => vi.useRealTimers());

describe("the match runner with a 3D presenter", () => {
  it("paints the world in 3D every frame, under a transparent overlay that keeps the HUD", () => {
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const overlay = createMockContext();
    const background = createMockContext();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: [
        { selection: { defId: "mario" }, cpuLevel: null },
        { selection: { defId: "kirby" }, cpuLevel: null },
      ],
      rules: RULES,
      getFighter: getFighterOrThrow,
      presenter,
      background: canvasWith(background),
    });
    runner.start(canvasWith(overlay));
    runner.stop();
    runner.advance(3);
    expect(presenter.paint).toHaveBeenCalledTimes(1);
    const [rs, , , hidden] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rs.world3d).toBe(true);
    expect(hidden).toEqual([false, false]);
    runner.dispose();
    expect(presenter.dispose).toHaveBeenCalledOnce();
    // The overlay is cleared, never filled black: the 3D layer must show through.
    expect(overlay.calls.some((c) => c.method === "clearRect")).toBe(true);
    expect(overlay.calls.some((c) => c.method === "fillRect" && c.args[2] === 1920 && c.args[3] === 1080)).toBe(false);
    // The stage's sky is painted on the background canvas under the 3D layer.
    expect(background.calls.some((c) => c.method === "fillRect")).toBe(true);
  });

  it("draws the whole frame in 2D, as before, with no presenter", () => {
    const overlay = createMockContext();
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: [
        { selection: { defId: "mario" }, cpuLevel: null },
        { selection: { defId: "kirby" }, cpuLevel: null },
      ],
      rules: RULES,
      getFighter: getFighterOrThrow,
    });
    runner.start(canvasWith(overlay));
    runner.stop();
    runner.advance(1);
    expect(overlay.calls.some((c) => c.method === "fillRect" && c.args[2] === 1920 && c.args[3] === 1080)).toBe(true);
    runner.dispose();
  });

  /**
   * DISPATCH-NOTES 20.1: an online match that has ended lingers after
   * `dispose`, re-sending its inputs; the presenter goes at once all the same,
   * on both of `dispose`'s paths.
   */
  it("frees the presenter on dispose, whether or not an online match lingers", () => {
    vi.useFakeTimers();
    const SHORT: MatchRules = { ...RULES, mode: "time", timeLimit: 3 };
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const presenters: WorldPresenter[] = [0, 1].map(() => ({ paint: vi.fn(), dispose: vi.fn() }));
    const onEnd = [vi.fn(), vi.fn()];
    const peers = [0, 1].map((port) =>
      createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players: [
          { selection: { defId: "mario" }, cpuLevel: null },
          { selection: { defId: "fox" }, cpuLevel: null },
        ],
        rules: SHORT,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        net: { transport: network.connect(port === 0 ? "host" : "guest"), localPorts: [port], inputDelay: 2, autoInputDelay: false, now: () => network.now(), lingerMs: 1_500 },
        onEnd: onEnd[port],
        presenter: presenters[port],
      }),
    );
    network.advance(0);
    for (let i = 0; i < 120 && !(onEnd[0].mock.calls.length > 0 && onEnd[1].mock.calls.length > 0); i++) {
      for (const p of peers) p.advance(1);
      network.advance(FRAME_MS);
    }
    expect(onEnd[0]).toHaveBeenCalledTimes(1);
    // Ended: the session lingers, the 3D world does not.
    peers[0].dispose();
    expect(presenters[0].dispose).toHaveBeenCalledOnce();

    // Not ended, or no linger: the session closes, and the presenter goes with it.
    const unended = { paint: vi.fn(), dispose: vi.fn() };
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: [
        { selection: { defId: "mario" }, cpuLevel: null },
        { selection: { defId: "fox" }, cpuLevel: null },
      ],
      rules: RULES,
      getFighter: getFighterOrThrow,
      net: { transport: createNullTransport(), localPorts: [0], lingerMs: 1_500 },
      presenter: unended,
    });
    runner.dispose();
    runner.dispose();
    expect(unended.dispose).toHaveBeenCalledOnce();
    peers[1].dispose();
    vi.advanceTimersByTime(2_000);
  });
});

describe("the overlay's anchors over the 3D world", () => {
  it("hands the overlay each fighter's head, from the installed bake", () => {
    installBake(readBakeFromDisk());
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const runner = createMatchRunner({
      stage: getStageOrThrow("battlefield"),
      players: [
        { selection: { defId: "donkeyKong" }, cpuLevel: null },
        { selection: { defId: "kirby" }, cpuLevel: null },
      ],
      rules: RULES,
      getFighter: (id) => GAME_SIM_CONTEXT.fighter(id),
      presenter,
      background: canvasWith(createMockContext()),
    });
    runner.start(canvasWith(createMockContext()));
    runner.stop();
    runner.advance(1);
    const [rs] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rs.anchors).toHaveLength(2);
    runner.state.fighters.forEach((f, i) => {
      expect(rs.anchors[i]).toEqual(overlayAnchor(GAME_SIM_CONTEXT.fighter(f.defId), f, runner.state.frame, GAME_SIM_CONTEXT.bake));
      expect(rs.anchors[i].headTop).toBeGreaterThan(5);
    });
    runner.dispose();
  });

  /**
   * The Task 14 carry: every world-anchored thing the overlay draws goes through
   * `worldToScreen` with the very camera the 3D layer is framed by
   * (`applySideCamera`). Run with the real presenter, after the camera has moved
   * off its first framing: the tag the overlay hangs over each head lands on the
   * pixel the 3D camera projects that head to.
   */
  it("frames the overlay and the 3D world with one camera: each tag sits over the head the 3D camera draws", async () => {
    installBake(readBakeFromDisk());
    const stage = getStageOrThrow("battlefield");
    const defs = ["donkeyKong", "marth"].map((id) => GAME_SIM_CONTEXT.fighter(id));
    let seen: PerspectiveCamera | null = null;
    const gl: GLLike = {
      domElement: document.createElement("canvas"),
      info: { render: { calls: 0, triangles: 0 } },
      setPixelRatio: () => {},
      setSize: () => {},
      setClearColor: () => {},
      render: (_scene: Object3D, camera: ThreeCamera) => {
        seen = camera as PerspectiveCamera;
      },
      dispose: () => {},
    };
    // No model index: both fighters are stand-ins, which hang off the same bones.
    const models = createModelCache({ index: async () => null, load: async () => Promise.reject(new Error("unused")) }, () => {});
    const real = createRenderer3D({ canvas: gl.domElement, stage, defs, bake: GAME_SIM_CONTEXT.bake!, skeletons: SKELETONS, models, makeGL: () => gl });
    await real.ready;
    const presenter: WorldPresenter = { paint: vi.fn(real.paint), dispose: vi.fn(real.dispose) };
    const runner = createMatchRunner({
      stage,
      players: [
        { selection: { defId: "donkeyKong" }, cpuLevel: 9 },
        { selection: { defId: "marth" }, cpuLevel: 9 },
      ],
      rules: RULES,
      getFighter: (id) => GAME_SIM_CONTEXT.fighter(id),
      presenter,
      background: canvasWith(createMockContext()),
    });
    runner.start(canvasWith(createMockContext()));
    runner.stop();
    runner.advance(150);
    // Measured on a frame where a fighter moves, by less than a snap: `advance`
    // paints at alpha 0, so both layers draw last frame's position, and a tag
    // hung on this frame's would be off by the move.
    const movedBy = (rs: RenderState, f: FighterState) => {
      const was = rs.previous?.fighters.find((g) => g.port === f.port);
      return was === undefined ? 0 : Math.hypot(toFloat(f.x - was.x), toFloat(f.y - was.y));
    };
    let moved = 0;
    for (let i = 0; i < 600 && !(moved > 0.25 && moved < INTERPOLATION_SNAP_UNITS); i++) {
      vi.mocked(characterArt.drawPortTag).mockClear();
      runner.advance(1);
      const rs = vi.mocked(presenter.paint).mock.calls.at(-1)![0];
      const tagged = vi.mocked(characterArt.drawPortTag).mock.calls.length === 2;
      moved = tagged ? Math.max(...runner.state.fighters.map((f) => movedBy(rs, f))) : 0;
    }
    expect(moved, "a frame on which a fighter moves").toBeGreaterThan(0.25);
    const [rs, camera] = vi.mocked(presenter.paint).mock.calls.at(-1)!;
    // One object, read by both layers in the same paint.
    expect(camera).toBe(runner.camera);
    expect(seen).not.toBeNull();
    const tags = vi.mocked(characterArt.drawPortTag).mock.calls;
    expect(tags).toHaveLength(2);
    for (const f of runner.state.fighters) {
      const a = rs.anchors![f.port]!;
      // Where both layers draw the fighter this paint: between the last two frames.
      const p = interpolatePosition(rs.previous?.fighters.find((g) => g.port === f.port), f, 0);
      const at = new Vector3(p.x + a.headX, p.y + a.headTop + 1, 0).project(seen!);
      const tag = tags.find((t) => t[3] === f.port)!;
      expect(tag[1]).toBeCloseTo(((at.x + 1) / 2) * VIEW_WIDTH, 2);
      expect(tag[2] + 14).toBeCloseTo(((1 - at.y) / 2) * VIEW_HEIGHT, 2);
    }
    // The camera had moved: the match is not still on its first framing.
    const first = createCamera(stage);
    expect([runner.camera.x, runner.camera.y, runner.camera.zoom]).not.toEqual([first.x, first.y, first.zoom]);
    runner.dispose();
    expect(presenter.dispose).toHaveBeenCalledOnce();
  });
});
