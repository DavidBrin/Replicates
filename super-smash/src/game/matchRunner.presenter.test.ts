import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Vector3, type Camera as ThreeCamera, type Object3D, type PerspectiveCamera } from "three";

import { toFloat } from "@/engine/fixed";
import type { FighterState, MatchRules, StepEvents } from "@/engine/types";
import { LoopbackNetwork } from "@/net/adapters/loopback";
import { createNullTransport } from "@/net/transport";
import { VIEW_HEIGHT, VIEW_WIDTH, cameraTarget, createCamera } from "@/render/camera";
import * as characterArt from "@/render/characterArt";
import { countCapsules, createMockContext } from "@/render/mockContext";
import { INTERPOLATION_SNAP_UNITS, interpolatePosition, sceneShiftAt, type RenderState } from "@/render/renderer";
import { drawnTop, overlayAnchor } from "@/render3d/anchors";
import { claimContext } from "@/render3d/fakeContext";
import { createModelCache } from "@/render3d/models/loader";
import { createRenderer3D, type GLLike } from "@/render3d/renderer3d";
import { SKELETONS } from "@/render3d/skeletons";
import { installBake } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
import { GAME_SIM_CONTEXT } from "./simContext";
import { FRAME_MS, createMatchRunner, type MatchRunnerOptions, type WorldPresenter } from "./matchRunner";

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
    const [, , , hidden] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(hidden).toEqual([false, false]);
    runner.dispose();
    expect(presenter.dispose).toHaveBeenCalledOnce();
    // The overlay is cleared, never filled black: the 3D layer must show through.
    expect(overlay.calls.some((c) => c.method === "clearRect")).toBe(true);
    expect(overlay.calls.some((c) => c.method === "fillRect" && c.args[2] === 1920 && c.args[3] === 1080)).toBe(false);
    // The stage's sky is painted on the background canvas under the 3D layer.
    expect(background.calls.some((c) => c.method === "fillRect")).toBe(true);
  });

  /**
   * Plan 4, Task 23: the overlay is the only 2D mode. Without a presenter (a
   * unit test, no GPU) there is no world under it, and no figure on it either:
   * the 2D figure's mark is the capsule (`countCapsules`), which the HUD's
   * portraits draw too, so the frame with both fighters standing draws exactly
   * as many as the same frame with both dead (as `renderer.test.ts` measures).
   */
  it("draws only the overlay with no presenter: cleared, no sky and no fighter", () => {
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
    expect(overlay.calls.some((c) => c.method === "clearRect")).toBe(true);
    expect(overlay.calls.some((c) => c.method === "fillRect" && c.args[2] === 1920 && c.args[3] === 1080)).toBe(false);
    // The HUD is still drawn.
    expect(overlay.calls.some((c) => c.method === "fillText")).toBe(true);
    // No fighter: the same frame with nobody alive draws no fewer capsules.
    const standing = countCapsules(overlay);
    expect(standing, "the portraits' capsules: the count can see one").toBeGreaterThan(0);
    expect(runner.state.fighters.map((f) => f.action)).not.toContain("dead");
    for (const f of runner.state.fighters) (f as { action: string }).action = "dead";
    runner.redraw();
    expect(countCapsules(overlay) - standing).toBe(standing);
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

describe("the camera a Final Smash's scene gets (Plan 5, Task 17 fix round 2)", () => {
  /** Donkey Kong at −30 in Jungle Rush's `move` on `actionFrame`, Mario trapped 8 ahead: the scene, mid-play. */
  function scene(move: "finalSmash" | "finalAttack" | "finalEnd", actionFrame: number, presenter?: WorldPresenter, onFrame?: MatchRunnerOptions["onFrame"]) {
    installBake(readBakeFromDisk());
    const runner = createMatchRunner({
      ...(presenter === undefined ? {} : { presenter }),
      ...(onFrame === undefined ? {} : { onFrame }),
      stage: getStageOrThrow("finalDestination"),
      players: [
        { selection: { defId: "donkeyKong" }, cpuLevel: null },
        { selection: { defId: "mario" }, cpuLevel: null },
      ],
      rules: RULES,
      getFighter: (id) => GAME_SIM_CONTEXT.fighter(id),
      background: canvasWith(createMockContext()),
    });
    runner.start(canvasWith(createMockContext()));
    runner.stop();
    const [dk, mario] = runner.state.fighters;
    Object.assign(dk, { action: "special", move, actionFrame, x: -30 * 4096, y: 0, grounded: true, platform: 0, facing: 1, intangible: 60 });
    Object.assign(mario, { action: "finalTrapped", actionFrame: 40, x: -22 * 4096, y: 0, grounded: true, platform: 0, facing: -1, hitstun: 0, hitlag: 0 });
    mario.combat.trappedBy = 0;
    runner.state.cinematic = 0;
    return runner;
  }

  it("frames the scene to keep its user whole, from how tall the bake draws it: Donkey Kong's tag over his head; and hands the drawing the same tops", () => {
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const runner = scene("finalAttack", 20, presenter);
    runner.advance(1);
    const s = runner.state;
    const tops = s.fighters.map((f) => drawnTop(GAME_SIM_CONTEXT.fighter(f.defId), f, s.frame, GAME_SIM_CONTEXT.bake));
    const [rs, , alpha] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(rs.tops).toEqual(tops);
    // And the shift, eased once a paint for both drawers (R-T17o): held, so as measured.
    expect(rs.sceneShift).toEqual(sceneShiftAt(rs, alpha));
    expect(rs.sceneShift[0]).toBeLessThan(0);
    expect(tops[0]).toBeGreaterThan(30);
    const stage = getStageOrThrow("finalDestination");
    expect(s.cinematic).toBe(0);
    expect(runner.camera.targetZoom).toBeCloseTo(cameraTarget(s, stage, tops).zoom, 9);
    expect(runner.camera.targetZoom).toBeLessThan(cameraTarget(s, stage).zoom * 0.95);
    runner.dispose();
  });

  it("eases the release it hands the drawing: a fighter let go closes the gap over frames, not in one (R-T17o)", () => {
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const runner = scene("finalAttack", 20, presenter);
    runner.advance(1);
    const shiftOf = () => (presenter.paint as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].sceneShift[0] as number;
    const held = shiftOf();
    expect(held).toBeLessThan(-1);
    // Let Mario go, far off: the shift this step measures is none.
    const mario = runner.state.fighters[1];
    Object.assign(mario, { action: "stand", x: 60 * 4096 });
    mario.combat.trappedBy = -1;
    runner.advance(1);
    expect(shiftOf()).toBeLessThan(0);
    expect(shiftOf()).toBeGreaterThan(held);
  });

  it("eases it once a paint, at the paint's own sim time: two paints inside one step draw the release at two places (R-T17o; the re-review 3's N11)", () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queued.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      installBake(readBakeFromDisk());
      const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
      const runner = createMatchRunner({
        presenter,
        stage: getStageOrThrow("finalDestination"),
        players: [
          { selection: { defId: "donkeyKong" }, cpuLevel: null },
          { selection: { defId: "mario" }, cpuLevel: null },
        ],
        rules: RULES,
        getFighter: (id) => GAME_SIM_CONTEXT.fighter(id),
        background: canvasWith(createMockContext()),
      });
      // The loop's clock starts at 0 (`performance.now`); each queued frame is the browser's next.
      runner.start(canvasWith(createMockContext()));
      const [dk, mario] = runner.state.fighters;
      Object.assign(dk, { action: "special", move: "finalAttack", actionFrame: 20, x: -30 * 4096, y: 0, grounded: true, platform: 0, facing: 1, intangible: 60 });
      Object.assign(mario, { action: "finalTrapped", actionFrame: 40, x: -22 * 4096, y: 0, grounded: true, platform: 0, facing: -1, hitstun: 0, hitlag: 0 });
      mario.combat.trappedBy = 0;
      runner.state.cinematic = 0;
      const paint = (ms: number) => {
        queued.at(-1)!(ms);
        const [rs, , alpha] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
        return { shift: rs.sceneShift[0] as number, alpha: alpha as number };
      };
      // A step, painted on it: backed off Mario, 8 ahead, to the barrage's 12.
      expect(paint(FRAME_MS).shift).toBe(-4);
      // Let him go; the next step lets go of the shift, which closes over 7 frames.
      Object.assign(runner.state.fighters[1], { action: "stand", x: 60 * 4096 });
      runner.state.fighters[1].combat.trappedBy = -1;
      const onStep = paint(2 * FRAME_MS);
      expect(onStep.alpha).toBe(0);
      expect(onStep.shift).toBeCloseTo(-4 + 4 / 7, 9);
      // Half a frame on, with no step between: the same release, half a frame further.
      const halfway = paint(2.5 * FRAME_MS);
      expect(halfway.alpha).toBeCloseTo(0.5, 9);
      expect(halfway.shift).toBeCloseTo(-4 + 4 / 7 + 2 / 7, 9);
      runner.dispose();
    } finally {
      vi.unstubAllGlobals();
      now.mockRestore();
    }
  });

  it("sparks the uppercut's hit where Donkey Kong is drawn: the contact point plus the shift it hands the drawing (fix round 4, ruling R-T17s)", () => {
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const hits: StepEvents["hits"] = [];
    // From the barrage's start, so the sim plays it and hands over to the uppercut itself.
    const runner = scene("finalAttack", 0, presenter, (state, events) => {
      if (state.fighters[0].move === "finalEnd") hits.push(...events.hits);
    });
    for (let i = 0; i < 200 && hits.length === 0; i++) runner.advance(1);
    expect(hits.map((h) => h.attacker)).toEqual([0]);
    const [rs] = (presenter.paint as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    // Backed off Mario, 8 ahead, to the uppercut's 13.
    expect(rs.sceneShift[0]).toBe(-5);
    const burst = runner.vfx.particles.find((p) => p.kind === "burst")!;
    expect([burst.x, burst.y]).toEqual([toFloat(hits[0].contactX) - 5, toFloat(hits[0].contactY)]);
    runner.dispose();
  });

  it("sparks a punch that lands while Donkey Kong is let go of part way where he is drawn then, not where the release ends (R-T17s)", () => {
    const presenter: WorldPresenter = { paint: vi.fn(), dispose: vi.fn() };
    const hits: StepEvents["hits"] = [];
    // The start's last frame, so the sim hands over to the barrage itself; Mario held 2 ahead.
    const runner = scene("finalSmash", 36, presenter, (_, events) => hits.push(...events.hits));
    runner.state.fighters[1].x = -28 * 4096;
    const handed = () => (presenter.paint as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].sceneShift[0] as number;
    for (let i = 0; i < 80 && hits.length === 0; i++) runner.advance(1);
    // The barrage's first punch; a frame on, he is drawn backed off to its 12.
    expect(runner.state.fighters[0].move).toBe("finalAttack");
    runner.advance(1);
    expect(handed()).toBe(-10);
    // Now Mario 6 ahead: the need falls to 6, eased over 7 frames, and the next punch
    // (5 frames after the last) lands on the way.
    runner.state.fighters[1].x = -24 * 4096;
    hits.length = 0;
    let before = handed();
    for (let i = 0; i < 10 && hits.length === 0; i++) {
      before = handed();
      runner.advance(1);
    }
    expect(hits.map((h) => h.attacker)).toEqual([0]);
    const after = handed();
    expect(after).toBeLessThan(-6);
    expect(after - before).toBeCloseTo(4 / 7, 9);
    // The punch's step drawn whole: a frame on from the paint at its start.
    const burst = runner.vfx.particles.find((p) => p.kind === "burst")!;
    expect(burst.x - toFloat(hits[0].contactX)).toBeCloseTo(after + 4 / 7, 9);
    runner.dispose();
  });

  it("punches in on the uppercut's hit, read off the move the runner hands it", () => {
    // From the barrage's start, so the sim plays it and hands over to the uppercut itself.
    const runner = scene("finalAttack", 0);
    let launched = -1;
    for (let i = 0; i < 200 && launched < 0; i++) {
      runner.advance(1);
      expect(runner.camera.koZoom.active, `frame ${i}`).toBe(runner.state.fighters[1].action !== "finalTrapped");
      if (runner.state.fighters[1].action !== "finalTrapped") launched = i;
    }
    expect(launched).toBeGreaterThan(0);
    expect(runner.state.fighters[0].move).toBe("finalEnd");
    expect(runner.camera.koZoom.keep?.port).toBe(0);
    runner.dispose();
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
    // On the canvas's modelled context (`fakeContext.ts`): a presenter that forced it lost would leave no next match a renderer.
    const glFor = (canvas: HTMLCanvasElement): GLLike => ({
      domElement: canvas,
      info: { render: { calls: 0, triangles: 0 } },
      setPixelRatio: () => {},
      setSize: () => {},
      setClearColor: () => {},
      render: (_scene: Object3D, camera: ThreeCamera) => {
        seen = camera as PerspectiveCamera;
      },
      dispose: () => {},
      ...claimContext(canvas),
    });
    const gl = glFor(document.createElement("canvas"));
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
    // The runner's dispose left the canvas to the next match: a renderer builds on it.
    const next = createRenderer3D({ canvas: gl.domElement, stage, defs, bake: GAME_SIM_CONTEXT.bake!, skeletons: SKELETONS, models, makeGL: glFor });
    next.dispose();
  });
});
