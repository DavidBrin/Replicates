import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  AmbientLight,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EventDispatcher,
  FrontSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  type Camera as ThreeCamera,
  type Side,
  type ToneMapping,
  type Material,
  type Mesh,
  type Texture,
} from "three";

import { fx, toFloat } from "@/engine/fixed";
import { platformCentreX } from "@/engine/physics";
import { shieldBubble } from "@/engine/shield";
import { createInitialState } from "@/engine/simulate";
import type { FighterState, GameState } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { bootstrapEngine } from "@/game/bootstrap";
import { readBakeFromDisk } from "@/game/bakeNode";
import { createCamera } from "@/render/camera";
import { createHudState } from "@/render/hud";
import type { RenderState } from "@/render/renderer";
import { createVfx, hitFlashAmount, HIT_FLASH_FRAMES, type Particle } from "@/render/vfx";
import { STAGES } from "@/stages";
import { MAX_TRIANGLES } from "../../scripts/models/glb.mjs";
import { fighterPoser } from "./bake/bake";
import { MAX_DRAW_CALLS, MAX_FIGHTER_PRIMITIVES, MAX_TRIANGLES_PER_FRAME } from "./budget";
import { createFighter3D } from "./fighter3d";
import { LOST_CONTEXT_ERROR, claimContext } from "./fakeContext";
import { createModelCache, parseModelIndex, type ModelCache, type ModelIndexEntry } from "./models/loader";
import { CONTEXT_RESTORE_WAIT_MS, NO_WEBGL, bufferSizeFor, createRenderer3D, type GLLike } from "./renderer3d";
import { SKELETONS } from "./skeletons";
import { bonesFromRig } from "./threeRig";
import { HIT_FLASH_GAIN, type ToonMaterial } from "./toon";
import { MAX_SHIELDS, MAX_SPRITES } from "./vfx3d";

const bake = readBakeFromDisk();
const stageOf = (id: string) => STAGES.find((s) => s.id === id)!;
// The game's fighters: limb-bone scripts on, placed through the bake (ruling R1).
const defs = ["mario", "fox", "kirby", "donkeyKong"].map((id) => withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones));

/**
 * The slice of `WebGLRenderer` the presenter uses, counting as three does: before
 * drawing, `render` updates the scene's matrices unless `scene.matrixWorldAutoUpdate`
 * is off, and a parentless camera's (three r186 `WebGLRenderer.render`); then one
 * draw per visible mesh (per material group), none for an instanced mesh with no
 * instances, and its triangles once per instance. A transparent double-sided
 * material draws twice, back faces then front, unless `forceSinglePass`
 * (`WebGLRenderer.js:2165-2176`). Its canvas's context is modelled
 * (`fakeContext.ts`): `forceContextLoss` loses it for good, and a renderer
 * cannot then be built on that canvas, as three's cannot (Task 20 carry 14).
 */
function fakeGL(canvas: HTMLCanvasElement) {
  const context = claimContext(canvas);
  const gl = {
    domElement: canvas,
    info: { render: { calls: 0, triangles: 0 } },
    /** The scene of the last draw, and a look at it while it is drawn. */
    scene: null as Object3D | null,
    look: null as ((scene: Object3D) => void) | null,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    /** What the presenter sets them to: three's defaults are the same, so only the fake shows it set them. */
    toneMapping: undefined as ToneMapping | undefined,
    outputColorSpace: undefined as string | undefined,
    render: vi.fn((scene: Object3D, camera: ThreeCamera) => {
      if ((scene as Object3D & { matrixWorldAutoUpdate: boolean }).matrixWorldAutoUpdate) scene.updateMatrixWorld();
      if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
      let calls = 0;
      let triangles = 0;
      scene.traverseVisible((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const instances = (o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh).count : 1;
        if (instances === 0) return;
        const g = mesh.geometry;
        const vertices = g.index?.count ?? (g.attributes.position as BufferAttribute | undefined)?.count ?? 0;
        const passes = (m: Material) => (m.transparent && m.side === DoubleSide && !m.forceSinglePass ? 2 : 1);
        const groups = Array.isArray(mesh.material) && g.groups.length > 0 ? g.groups : [{ count: vertices, materialIndex: 0 }];
        for (const group of groups) {
          const m = Array.isArray(mesh.material) ? mesh.material[group.materialIndex ?? 0] : mesh.material;
          calls += passes(m);
          triangles += (Math.min(group.count, vertices) / 3) * instances * passes(m);
        }
      });
      gl.info.render.calls = calls;
      gl.info.render.triangles = triangles;
      gl.scene = scene;
      gl.look?.(scene);
    }),
    dispose: vi.fn(),
    /** Three's, which the presenter must never call: the next match's renderer on this canvas could not be built. */
    forceContextLoss: vi.fn(context.forceContextLoss),
  };
  return gl satisfies GLLike;
}

/** Sources of the stand-in glbs below, by file, so a test can check the cache's own objects. */
const glbScenes = new Map<string, Group>();

/**
 * A glb as `pnpm models` builds it at its worst, never a real one: the fighter's
 * bones, `MAX_FIGHTER_PRIMITIVES` skinned primitives bound to one skeleton (three's
 * GLTFLoader binds every primitive of a skinned mesh to one), `MAX_TRIANGLES`
 * triangles between them (`glb.mjs`'s caps), and a colour texture.
 */
function glbAtTheCap(entry: ModelIndexEntry, side: Side = FrontSide): Object3D {
  const def = defs.find((d) => entry.file.startsWith(`${d.id}.`))!;
  const scene = new Group();
  const bones = bonesFromRig(fighterPoser(def, SKELETONS[def.id]).rig3);
  scene.add(bones[0]);
  scene.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones, bones.map((b) => b.matrixWorld.clone().invert()));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array((MAX_TRIANGLES / MAX_FIGHTER_PRIMITIVES) * 9), 3));
  const map = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  for (let i = 0; i < MAX_FIGHTER_PRIMITIVES; i++) {
    const part = new SkinnedMesh(geometry, new MeshStandardMaterial({ map, side, name: `part${i}` }));
    scene.add(part);
    part.bind(skeleton, new Matrix4());
  }
  glbScenes.set(entry.file, scene);
  return scene;
}

/** A cache whose index lists `ids` (each loads `glbAtTheCap`); every other fighter is a stand-in. */
function capCache(ids: readonly string[], warn = vi.fn(), side: Side = FrontSide): ModelCache {
  const index = parseModelIndex({ schema: 1, models: Object.fromEntries(ids.map((id) => [id, { file: `${id}.00000000.glb`, bytes: 1, sha256: "x" }])) });
  return createModelCache({ index: async () => index, load: async (e) => glbAtTheCap(e, side) }, warn);
}

const RULES = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false } as const;

function setup(opts: { models?: ModelCache; stageId?: string; canvas?: HTMLCanvasElement; onContextGone?: (gone: boolean) => void } = {}) {
  bootstrapEngine();
  const stage = stageOf(opts.stageId ?? "battlefield");
  const canvas = opts.canvas ?? document.createElement("canvas");
  let gl!: ReturnType<typeof fakeGL>;
  const warn = vi.fn();
  const presenter = createRenderer3D({
    canvas,
    stage,
    defs,
    bake,
    skeletons: SKELETONS,
    // By default no `pnpm models`: every fighter must come out as a stand-in, and the match must still paint.
    models: opts.models ?? createModelCache({ index: async () => null, load: async () => { throw new Error("unreachable"); } }, warn),
    makeGL: (c) => (gl = fakeGL(c)),
    onContextGone: opts.onContextGone,
  });
  const state: GameState = createInitialState(stage.id, defs.map((d) => ({ defId: d.id })), RULES, 1);
  const rs: RenderState = { current: state, previous: null, stage, fighters: defs, vfx: createVfx(), hud: createHudState() };
  return { canvas, gl: () => gl, presenter, rs, state, stage, warn };
}

/** Every fighter on its feet, doing `action`. */
function standAll(state: GameState, action: FighterState["action"] = "stand"): void {
  state.fighters.forEach((f, i) => (state.fighters[i] = { ...f, action, actionFrame: 0, grounded: true }));
}

/** A screen full of effects: the sprite pool full of sparks and bursts. */
function fillSparks(rs: RenderState): void {
  const spark: Particle = { kind: "spark", x: 0, y: 30, vx: 1, vy: 0.5, life: 5, maxLife: 6, size: 1, colour: "#ffcc00", rotation: 0, spin: 0, gravity: 0, drag: 0 };
  for (let i = 0; i < MAX_SPRITES; i++) rs.vfx.particles.push({ ...spark, kind: i % 4 === 0 ? "burst" : "spark" });
}

/** Everything the GPU would hold for a drawn scene. */
function resourcesOf(scene: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const instanced = new Set<InstancedMesh>();
  const skeletons = new Set<Skeleton>();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const m of [mesh.material].flat()) {
      materials.add(m);
      for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) textures.add(v as Texture);
    }
    if ((o as InstancedMesh).isInstancedMesh) instanced.add(o as InstancedMesh);
    if ((o as SkinnedMesh).isSkinnedMesh) {
      const { skeleton } = o as SkinnedMesh;
      skeletons.add(skeleton);
      if (skeleton.boneTexture !== null) textures.add(skeleton.boneTexture);
    }
  });
  return { geometries, materials, textures, instanced, skeletons };
}

function instanceAt(scene: Object3D, name: string, i: number) {
  const mesh = scene.getObjectByName(name) as InstancedMesh;
  const m = new Matrix4();
  mesh.getMatrixAt(i, m);
  const position = new Vector3();
  const scale = new Vector3();
  m.decompose(position, new Quaternion(), scale);
  return { count: mesh.count, position, scale };
}

describe("the 3D presenter", () => {
  it("paints four stand-in fighters when no models were built (Review Focus #1), inside the draw-call budget", async () => {
    const { presenter, rs, gl, warn, stage } = setup();
    await presenter.ready;
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).toHaveBeenCalledOnce();
    expect(presenter.info().fighters).toEqual(["standIn", "standIn", "standIn", "standIn"]);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(presenter.info().calls).toBeLessThan(MAX_DRAW_CALLS);
    expect(presenter.info().triangles).toBeLessThan(MAX_TRIANGLES_PER_FRAME);
  });

  it("stays inside the draw-call and triangle budget with four models at the glb.mjs caps and every effect live (MAJOR 3)", async () => {
    const { presenter, rs, state, stage, gl } = setup({ models: capCache(defs.map((d) => d.id)) });
    await presenter.ready;
    standAll(state, "shield");
    fillSparks(rs);
    presenter.paint(rs, createCamera(stage), 1, []);
    expect(presenter.info().fighters).toEqual(["glb", "glb", "glb", "glb"]);
    const scene = gl().scene!;
    // Effects live: a full sprite pool, four shields, four shadows.
    expect(instanceAt(scene, "sparks", 0).count).toBe(MAX_SPRITES);
    expect(instanceAt(scene, "shields", 0).count).toBe(MAX_SHIELDS);
    expect(instanceAt(scene, "shadows", 0).count).toBe(4);
    const { calls, triangles } = presenter.info();
    expect(calls).toBeGreaterThanOrEqual(4 * MAX_FIGHTER_PRIMITIVES + 3);
    expect(calls).toBeLessThan(MAX_DRAW_CALLS);
    expect(triangles).toBeGreaterThanOrEqual(4 * MAX_TRIANGLES);
    expect(triangles).toBeLessThan(MAX_TRIANGLES_PER_FRAME);
    // One skeleton per fighter, however many parts it has: one bone texture to upload, not twelve (Task 17 carry).
    expect(resourcesOf(scene).skeletons.size).toBe(4);
  });

  it("stays inside the draw-call budget with double-sided glbs at the caps while every fighter fades: three would draw each part twice", async () => {
    const { presenter, rs, state, stage, gl } = setup({ models: capCache(defs.map((d) => d.id), vi.fn(), DoubleSide) });
    await presenter.ready;
    standAll(state, "shield");
    // Intangible, so the fade (`setFade`) makes every part of every fighter transparent.
    state.fighters.forEach((f, i) => (state.fighters[i] = { ...f, intangible: 10 }));
    fillSparks(rs);
    presenter.paint(rs, createCamera(stage), 1, []);
    const parts = [...resourcesOf(gl().scene!).materials].filter((m) => m.type === "MeshToonMaterial");
    expect(parts).toHaveLength(4 * MAX_FIGHTER_PRIMITIVES);
    expect(parts.every((m) => m.transparent && m.side === DoubleSide)).toBe(true);
    // Two passes each would be 4 × 12 × 2 + 7 = 103.
    expect(presenter.info().calls).toBe(4 * MAX_FIGHTER_PRIMITIVES + 7);
    expect(presenter.info().calls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
    expect(presenter.info().triangles).toBeLessThan(MAX_TRIANGLES_PER_FRAME);
  });

  it("builds every matrix in the scene once a frame: three's own pass over the scene would build them all again (Task 17 carry)", async () => {
    const { presenter, rs, state, stage, gl } = setup({ models: capCache(["mario", "fox"]) });
    await presenter.ready;
    standAll(state);
    presenter.paint(rs, createCamera(stage), 1, []);
    const updated = vi.spyOn(Object3D.prototype, "updateMatrix");
    presenter.paint(rs, createCamera(stage), 1, []);
    const times = new Map<Object3D, number>();
    for (const o of updated.mock.contexts as Object3D[]) times.set(o, (times.get(o) ?? 0) + 1);
    updated.mockRestore();
    // The camera's are `applySideCamera`'s own: its `lookAt` builds the matrix to find where the camera is, then
    // its update builds it with the new turn. That is two, and three's render adds none (the camera is in the scene).
    const camera = gl().render.mock.calls[0][1];
    expect(times.get(camera)).toBe(2);
    times.delete(camera);
    // The scene's own, too: once, as that `lookAt` walks up the camera's parents.
    const drawn: Object3D[] = [];
    gl().scene!.traverse((o) => {
      if (o !== camera && o.matrixAutoUpdate) drawn.push(o);
    });
    expect(drawn.length).toBeGreaterThan(150);
    expect(drawn.filter((o) => times.get(o) !== 1).map((o) => `${o.name || o.type}: ${times.get(o) ?? 0}`)).toEqual([]);
    // Nor anything outside the scene.
    expect([...times.values()].every((n) => n === 1)).toBe(true);
    expect(times.size).toBe(drawn.length);
  });

  it("draws everything at the frame it paints: moving platforms placed before the first draw, fighters on game.frame (Task 15 and 17 carries)", async () => {
    const { presenter, rs, state, stage, gl } = setup({ stageId: "smashville" });
    await presenter.ready;
    standAll(state);
    // Idle is the one status whose clock runs on the global frame (`poseIndexOf` "idle"): find a frame where Mario's head moves.
    const mario = defs[0];
    const poser = fighterPoser(mario, SKELETONS.mario);
    const head = poser.rig3.names[poser.rig3.byLower.get("head")!];
    const reference = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    const at = (frame: number) => {
      const f = state.fighters[0];
      reference.update({ f, x: toFloat(f.x), y: toFloat(f.y), frame, blends: createVfx().poseBlend, hitFlash: 0, hidden: false });
      const p = new Vector3();
      reference.bonePosition(head, p);
      return p;
    };
    const frame = Array.from({ length: 200 }, (_, k) => k + 1).find((k) => at(k).distanceTo(at(k + 1)) > 0.05)!;
    expect(frame).toBeDefined();
    state.frame = frame;
    const mover = stage.platforms.findIndex((p) => p.motion);
    let platformX = Number.NaN;
    let headAt = new Vector3();
    gl().look = (scene) => {
      // Read the matrices the draw uses, not positions: nothing recomputes them on the way.
      platformX = new Vector3().setFromMatrixPosition(scene.getObjectByName("stage:smashville")!.children[mover].matrixWorld).x;
      headAt = new Vector3().setFromMatrixPosition(scene.getObjectByName("fighter:0:mario")!.getObjectByName(head)!.matrixWorld);
    };
    presenter.paint(rs, createCamera(stage), 1, []);
    expect(platformX).toBeCloseTo(toFloat(platformCentreX(stage.platforms[mover], frame)), 9);
    expect(platformX).not.toBeCloseTo(toFloat(platformCentreX(stage.platforms[mover], frame + 1)), 3);
    expect(headAt.distanceTo(at(frame))).toBeLessThan(1e-6);
    expect(headAt.distanceTo(at(frame + 1))).toBeGreaterThan(0.05);
    reference.dispose();
  });

  it("puts a shield on the fighter it is drawn round, between frames too: the drawn position, the sim's bubble", async () => {
    const { presenter, rs, state, stage, gl } = setup();
    await presenter.ready;
    standAll(state, "shield");
    const now = state.fighters[0];
    const before: GameState = { ...state, fighters: state.fighters.map((f) => ({ ...f })) };
    // Sliding back and rising while shielding: 4 units across and 2 up since the last frame.
    before.fighters[0] = { ...now, x: now.x - fx(4), y: now.y - fx(2) };
    presenter.paint({ ...rs, previous: before }, createCamera(stage), 0.5, []);
    const scene = gl().scene!;
    const bubble = shieldBubble(now, defs[0]);
    const shield = instanceAt(scene, "shields", 0);
    expect(shield.position.x).toBeCloseTo(toFloat(bubble.x1) - 2, 9);
    expect(shield.position.y).toBeCloseTo(toFloat(bubble.y1) - 1, 9);
    expect(shield.scale.x).toBeCloseTo(toFloat(bubble.r), 9);
    // The same half-frame the fighter is drawn at.
    const placement = scene.getObjectByName("fighter:0:mario")!;
    expect(placement.position.x).toBeCloseTo(toFloat(now.x) - 2, 9);
    expect(shield.position.x - placement.position.x).toBeCloseTo(toFloat(bubble.x1) - toFloat(now.x), 9);
    // The ones standing still are where the sim has them.
    expect(instanceAt(scene, "shields", 1).position.x).toBeCloseTo(toFloat(shieldBubble(state.fighters[1], defs[1]).x1), 9);
  });

  it("casts one blob shadow per grounded fighter, at its feet, and none for the airborne or the dead", async () => {
    const { presenter, rs, state, stage, gl } = setup();
    await presenter.ready;
    standAll(state);
    state.fighters[1] = { ...state.fighters[1], grounded: false, action: "fall" };
    state.fighters[2] = { ...state.fighters[2], action: "dead" };
    presenter.paint(rs, createCamera(stage), 1, []);
    const scene = gl().scene!;
    expect(instanceAt(scene, "shadows", 0).count).toBe(2);
    for (const [i, port] of [[0, 0], [1, 3]] as const) {
      const shadow = instanceAt(scene, "shadows", i).position;
      expect(shadow.x).toBeCloseTo(toFloat(state.fighters[port].x), 9);
      expect(shadow.y - toFloat(state.fighters[port].y)).toBeGreaterThan(0);
      expect(shadow.y - toFloat(state.fighters[port].y)).toBeLessThan(0.1);
    }
  });

  it("lights the scene with the look's values, tone mapping off and sRGB out (UNVERIFIED by eye: pinned so any change is deliberate)", () => {
    const { presenter, rs, stage, gl } = setup();
    presenter.paint(rs, createCamera(stage), 1, []);
    const lights = gl().scene!.children;
    const hemisphere = lights.find((o) => (o as HemisphereLight).isHemisphereLight) as HemisphereLight;
    const ambient = lights.find((o) => (o as AmbientLight).isAmbientLight) as AmbientLight;
    const sun = lights.find((o) => (o as DirectionalLight).isDirectionalLight) as DirectionalLight;
    expect([hemisphere.intensity, hemisphere.color.getHex(), hemisphere.groundColor.getHex()]).toEqual([0.8, 0xffffff, 0x445066]);
    expect([ambient.intensity, ambient.color.getHex()]).toEqual([0.1, 0xffffff]);
    expect([sun.intensity, sun.color.getHex()]).toEqual([2.6, 0xffffff]);
    expect(gl().toneMapping).toBe(NoToneMapping);
    expect(gl().outputColorSpace).toBe(SRGBColorSpace);
    presenter.dispose();
  });

  it("flashes a struck fighter brighter in its own colours, never see-through: every opaque material stays opaque, writes depth, keeps alpha 1", async () => {
    // Mario and Fox from glbs (a colour texture each), Kirby and Donkey Kong as stand-ins.
    const { presenter, rs, state, stage, gl } = setup({ models: capCache(["mario", "fox"]) });
    await presenter.ready;
    standAll(state);
    // Past the entry's intangibility, whose blink is the one thing allowed to fade a fighter.
    state.fighters.forEach((f, i) => (state.fighters[i] = { ...f, intangible: 0, invincible: 0 }));
    presenter.paint(rs, createCamera(stage), 1, []);
    const toon = [...resourcesOf(gl().scene!).materials].filter((m): m is ToonMaterial => m.type === "MeshToonMaterial");
    const alphaOf = (m: ToonMaterial) => [m.transparent, m.depthWrite, m.opacity, m.alphaTest, m.version];
    const unflashed = toon.map(alphaOf);
    expect(toon.every((m) => m.emissive.getHex() === 0)).toBe(true);

    for (let p = 0; p < 4; p++) rs.vfx.hitFlash[p] = HIT_FLASH_FRAMES;
    presenter.paint(rs, createCamera(stage), 1, []);
    const amount = hitFlashAmount(rs.vfx, 0);
    expect(amount).toBeGreaterThan(0.8);
    expect(toon.length).toBeGreaterThan(20);
    // Not one material's alpha mode, opacity or program moved: the flash is light added, nothing composited.
    expect(toon.map(alphaOf)).toEqual(unflashed);
    for (const m of toon.filter((t) => !t.userData.alpha.transparent)) expect([m.transparent, m.depthWrite, m.opacity]).toEqual([false, true, 1]);
    for (const m of toon) {
      // Brighter by the fighter's own colours (the texture through `emissiveMap`), never washed to white.
      expect(m.emissiveMap).toBe(m.map);
      expect(m.emissive.r).toBeCloseTo(m.color.r * amount * HIT_FLASH_GAIN, 9);
      expect(m.emissive.g).toBeCloseTo(m.color.g * amount * HIT_FLASH_GAIN, 9);
      expect(m.emissive.b).toBeCloseTo(m.color.b * amount * HIT_FLASH_GAIN, 9);
    }
    presenter.dispose();
  });

  it("stops painting while the WebGL context is lost and resumes when it is restored, every material recompiled (Review Focus #2)", async () => {
    const { presenter, rs, gl, canvas, stage } = setup({ models: capCache(["mario", "fox"]) });
    await presenter.ready;
    presenter.paint(rs, createCamera(stage), 0, []);
    // What three's draw makes beside them: a bone texture for each skeleton.
    for (const s of resourcesOf(gl().scene!).skeletons) s.computeBoneTexture();
    const { geometries, materials, textures, instanced } = resourcesOf(gl().scene!);
    const versions = new Map([...materials].map((m) => [m, m.version]));
    const forgotten = new Map<object, number>();
    for (const r of [...geometries, ...materials, ...textures, ...instanced]) {
      (r as EventDispatcher<{ dispose: object }>).addEventListener("dispose", () => forgotten.set(r, (forgotten.get(r) ?? 0) + 1));
    }
    const clear = gl().setClearColor.mock.calls[0];
    expect(clear).toEqual([0x000000, 0]);
    gl().render.mockClear();
    gl().setClearColor.mockClear();
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    // Without it the browser never offers the context back.
    expect(lost.defaultPrevented).toBe(true);
    // Every GPU copy went with the context. three is told to forget each one now, while its deletes are no-ops:
    // otherwise its records of the old context (and their listeners) outlive it, and fire at the dead objects later.
    expect(textures.size).toBeGreaterThanOrEqual(5);
    expect([...geometries, ...materials, ...textures, ...instanced].filter((r) => forgotten.get(r) !== 1)).toEqual([]);
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).not.toHaveBeenCalled();
    expect(presenter.info().lost).toBe(true);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(presenter.info().lost).toBe(false);
    // The clear colour is the presenter's, put back: three's restore starts from its own default.
    expect(gl().setClearColor.mock.calls).toEqual([clear]);
    expect(materials.size).toBeGreaterThan(5);
    for (const [m, v] of versions) expect(m.version, m.name || m.type).toBeGreaterThan(v);
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).toHaveBeenCalledOnce();

    // A loss the browser never gives back: the match ends with the context already gone.
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    presenter.dispose();
    expect(gl().dispose).toHaveBeenCalledOnce();
  });

  /**
   * Final review, Declined #3: a context the browser never gives back left the
   * fighters invisible for the rest of the match with no word. The presenter
   * says so once the loss has lasted `CONTEXT_RESTORE_WAIT_MS`, and again if the
   * context comes back after all; a loss restored in time says nothing.
   */
  describe("a lost context that does not come back", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is reported once it has stayed lost for the stated wait, and taken back if the browser restores it after all", async () => {
      vi.useFakeTimers();
      const gone = vi.fn();
      const { presenter, canvas } = setup({ onContextGone: gone });
      await presenter.ready;
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      vi.advanceTimersByTime(CONTEXT_RESTORE_WAIT_MS - 1);
      expect(gone).not.toHaveBeenCalled();
      expect(presenter.info().lost).toBe(true);
      vi.advanceTimersByTime(1);
      expect(gone.mock.calls).toEqual([[true]]);
      vi.advanceTimersByTime(CONTEXT_RESTORE_WAIT_MS * 10);
      expect(gone).toHaveBeenCalledOnce();
      canvas.dispatchEvent(new Event("webglcontextrestored"));
      expect(gone.mock.calls).toEqual([[true], [false]]);
      expect(presenter.info().lost).toBe(false);
      presenter.dispose();
    });

    it("says nothing about a loss the browser restores within the wait, and starts the wait afresh on the next one", async () => {
      vi.useFakeTimers();
      const gone = vi.fn();
      const { presenter, canvas } = setup({ onContextGone: gone });
      await presenter.ready;
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      vi.advanceTimersByTime(CONTEXT_RESTORE_WAIT_MS - 1);
      canvas.dispatchEvent(new Event("webglcontextrestored"));
      vi.advanceTimersByTime(CONTEXT_RESTORE_WAIT_MS * 10);
      expect(gone).not.toHaveBeenCalled();
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      vi.advanceTimersByTime(CONTEXT_RESTORE_WAIT_MS - 1);
      expect(gone).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(gone.mock.calls).toEqual([[true]]);
      presenter.dispose();
    });

    it("tells nobody once the match is over", async () => {
      vi.useFakeTimers();
      const gone = vi.fn();
      const { presenter, canvas } = setup({ onContextGone: gone });
      await presenter.ready;
      expect(vi.getTimerCount()).toBe(0);
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      presenter.dispose();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(CONTEXT_RESTORE_WAIT_MS * 10);
      expect(gone).not.toHaveBeenCalled();
    });
  });

  /**
   * Final review M1: with no WebGL (switched off, blocked, or missing) the
   * player read three's own "THREE.WebGLRenderer: Error creating WebGL
   * context." The presenter says what is wrong and what to do; three's message
   * stays as the cause.
   */
  describe("no WebGL at all", () => {
    const build = (makeGL?: (canvas: HTMLCanvasElement) => GLLike) => () =>
      createRenderer3D({
        canvas: document.createElement("canvas"),
        stage: stageOf("battlefield"),
        defs,
        bake,
        skeletons: SKELETONS,
        models: createModelCache({ index: async () => null, load: async () => Promise.reject(new Error("unused")) }, () => {}),
        makeGL,
      });

    it("says what to do about it in a sentence of its own when the renderer cannot be built, keeping three's as the cause", () => {
      const three = new Error("THREE.WebGLRenderer: Error creating WebGL context.");
      const err = (() => {
        try {
          build(() => {
            throw three;
          })();
        } catch (e) {
          return e as Error;
        }
        return null;
      })();
      expect(err?.message).toBe(NO_WEBGL);
      expect(err?.message).toBe("This browser can't draw the 3D world (WebGL is off or unavailable): turn on hardware acceleration or try another browser.");
      expect(err?.cause).toBe(three);
    });

    it("says it for three's own renderer on a canvas that hands out no WebGL context", () => {
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      try {
        expect(build()).toThrow(NO_WEBGL);
        expect(getContext).toHaveBeenCalled();
      } finally {
        getContext.mockRestore();
      }
    });
  });

  it("sizes its buffer to the window and the display's pixel ratio, exactly 16:9, never past 1080p (Review Focus #3, Task 14 carry)", () => {
    expect(bufferSizeFor(1280, 720, 1)).toEqual({ width: 1280, height: 720 });
    expect(bufferSizeFor(1280, 720, 2)).toEqual({ width: 1920, height: 1080 });
    // 1000 wide is 562.5 tall at 16:9; the nearest buffer that is exactly 16:9 is 63 × (16, 9).
    expect(bufferSizeFor(1000, 900, 1)).toEqual({ width: 1008, height: 567 });
    expect(bufferSizeFor(100, 50, 1)).toEqual({ width: 320, height: 180 });
    expect(bufferSizeFor(Number.NaN, 0, Number.NaN)).toEqual({ width: 320, height: 180 });
    // `applySideCamera` frames 16:9 whatever it is given, so a buffer of any other shape stretches the layer.
    for (const dpr of [0.5, 1, 1.25, 1.5, 2, 2.625, 3]) {
      for (let w = 200; w <= 4000; w += 37) {
        for (const h of [w * 0.3, (w * 9) / 16, w * 0.75, w * 1.4]) {
          const b = bufferSizeFor(w, h, dpr);
          expect(b.width * 9, `${w}×${h} @${dpr}`).toBe(b.height * 16);
          expect(b.width).toBeLessThanOrEqual(1920);
          expect(b.width).toBeGreaterThanOrEqual(320);
          const fit = Math.min(w, (h * 16) / 9) * dpr;
          if (fit >= 320 && fit <= 1920) expect(Math.abs(b.width - fit), `${w}×${h} @${dpr}`).toBeLessThanOrEqual(8);
        }
      }
    }
    const { presenter, gl } = setup();
    presenter.resize(1280, 720, 1);
    expect(gl().setSize).toHaveBeenLastCalledWith(1280, 720, false);
    presenter.resize(1280, 720, 2);
    expect(gl().setSize).toHaveBeenLastCalledWith(1920, 1080, false);
    expect(gl().setPixelRatio).not.toHaveBeenCalledWith(2);
    expect(presenter.info().buffer).toEqual({ width: 1920, height: 1080 });
  });

  it("detaches every layer, then frees every geometry, material, texture and skeleton it drew, its listeners and its renderer, once", async () => {
    // Mario and Fox from glbs, Kirby and Donkey Kong as stand-ins: both kinds of fighter.
    const models = capCache(["mario", "fox"]);
    const { presenter, rs, state, stage, gl, canvas } = setup({ models });
    await presenter.ready;
    standAll(state, "shield");
    fillSparks(rs);
    presenter.paint(rs, createCamera(stage), 1, []);
    const scene = gl().scene!;
    for (const s of resourcesOf(scene).skeletons) s.computeBoneTexture();
    const layers = [...scene.children];
    expect(layers.map((o) => o.name)).toEqual(expect.arrayContaining(["stage:battlefield", "shadows", "vfx", "fighter:0:mario", "fighter:3:donkeyKong"]));
    const { geometries, materials, textures, instanced, skeletons } = resourcesOf(scene);
    const attachedAtFree: number[] = [];
    const freed = new Map<object, number>();
    for (const r of [...geometries, ...materials, ...textures, ...instanced]) {
      (r as EventDispatcher<{ dispose: object }>).addEventListener("dispose", () => {
        attachedAtFree.push(scene.children.length);
        freed.set(r, (freed.get(r) ?? 0) + 1);
      });
    }
    const skeletonFreed = [...skeletons].map((s) => vi.spyOn(s, "dispose"));
    // The cache's own materials were never drawn (each fighter draws its own copies), so they are not this renderer's.
    const cachedMaterials = [...glbScenes.values()].flatMap((s) => s.children.filter((o) => (o as Mesh).isMesh).map((o) => (o as Mesh).material as Material));
    const cachedFreed = vi.fn();
    for (const m of cachedMaterials) m.addEventListener("dispose", cachedFreed);
    const remove = vi.spyOn(canvas, "removeEventListener");
    const listened = vi.spyOn(EventDispatcher.prototype, "addEventListener");
    const unlistened = vi.spyOn(EventDispatcher.prototype, "removeEventListener");

    presenter.dispose();

    // It leaves no listener of its own on anything, the cache's shared models above all (they outlive the match).
    const pairs = (spy: typeof listened) => spy.mock.calls.map((c, i) => [spy.mock.contexts[i], c[0], c[1]]);
    const hung = pairs(listened);
    listened.mockRestore();
    expect(hung.length).toBeGreaterThan(0);
    expect(pairs(unlistened)).toEqual(expect.arrayContaining(hung));
    unlistened.mockRestore();

    // A freed layer never stays in the scene: all of them were detached before anything was freed.
    expect(attachedAtFree.length).toBeGreaterThan(0);
    expect(attachedAtFree.every((n) => n === 0)).toBe(true);
    for (const layer of layers) expect(layer.parent, layer.name || layer.type).toBeNull();
    // Each exactly once — the stage's, the effects', the shadows', the fighters' own, and the model cache's
    // geometry and textures, whose GPU copies (and the listeners three hung on them) were this renderer's.
    expect([...geometries, ...materials, ...textures, ...instanced].filter((r) => freed.get(r) !== 1)).toEqual([]);
    expect(textures.size).toBeGreaterThanOrEqual(4);
    for (const spy of skeletonFreed) expect(spy).toHaveBeenCalledOnce();
    expect(cachedFreed).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("webglcontextlost", expect.any(Function), false);
    expect(remove).toHaveBeenCalledWith("webglcontextrestored", expect.any(Function), false);
    expect(gl().dispose).toHaveBeenCalledOnce();

    gl().render.mockClear();
    presenter.paint(rs, createCamera(stage), 0, []);
    expect(gl().render).not.toHaveBeenCalled();
    presenter.dispose();
    expect(gl().dispose).toHaveBeenCalledOnce();
    expect([...freed.values()].every((n) => n === 1)).toBe(true);

    // The cache's models still draw: the next match's renderer uploads them again.
    const next = setup({ models });
    await next.presenter.ready;
    next.presenter.paint(next.rs, createCamera(stage), 1, []);
    expect(next.presenter.info().fighters).toEqual(["glb", "glb", "standIn", "standIn"]);
    expect(next.presenter.info().triangles).toBeGreaterThanOrEqual(2 * MAX_TRIANGLES);
    next.presenter.dispose();
  });

  /**
   * The Task 19 review, ruled in Task 20: `dispose` leaves the canvas's context
   * usable, because React's development remount (`reactStrictMode`) builds the
   * next match's presenter on the very same `<canvas>`. The browser half of
   * this (a second WebGLRenderer drawing on that canvas) is the e2e flow's
   * "two matches in a row"; here, the sequence and the listeners.
   */
  it("lets a second presenter draw on the same canvas once the first is disposed", async () => {
    const models = capCache(["mario"]);
    const first = setup({ models });
    await first.presenter.ready;
    first.presenter.paint(first.rs, createCamera(first.stage), 1, []);
    const added = vi.spyOn(first.canvas, "addEventListener");
    first.presenter.dispose();

    // The context is left usable, however a regression might spell the loss.
    expect(first.gl().forceContextLoss).not.toHaveBeenCalled();
    const second = setup({ models, canvas: first.canvas });
    await second.presenter.ready;
    expect(second.gl().domElement).toBe(first.canvas);
    second.presenter.paint(second.rs, createCamera(second.stage), 1, []);
    expect(second.gl().render).toHaveBeenCalledOnce();
    expect(second.presenter.info()).toMatchObject({ lost: false, fighters: ["glb", "standIn", "standIn", "standIn"] });
    expect(second.presenter.info().calls).toBeGreaterThan(0);
    // Only the second presenter listens to the canvas now: a lost context pauses it, and the first stays freed.
    expect(added.mock.calls.map((c) => c[0])).toEqual(["webglcontextlost", "webglcontextrestored"]);
    first.gl().render.mockClear();
    second.gl().render.mockClear();
    first.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(second.presenter.info().lost).toBe(true);
    expect(first.presenter.info().lost).toBe(false);
    first.canvas.dispatchEvent(new Event("webglcontextrestored"));
    second.presenter.paint(second.rs, createCamera(second.stage), 1, []);
    expect(second.gl().render).toHaveBeenCalledOnce();
    expect(first.gl().render).not.toHaveBeenCalled();
    second.presenter.dispose();
  });

  it("models the context it must leave usable: a canvas forced lost builds no second renderer", () => {
    const canvas = document.createElement("canvas");
    fakeGL(canvas).forceContextLoss();
    expect(() => fakeGL(canvas)).toThrow(LOST_CONTEXT_ERROR);
  });

  it("never builds a fighter whose model arrives after dispose", async () => {
    const scene = new Group();
    const cloned = vi.spyOn(scene, "clone");
    let arrive!: (o: Object3D) => void;
    const index = parseModelIndex({ schema: 1, models: { mario: { file: "mario.00000000.glb", bytes: 1, sha256: "x" } } });
    const models = createModelCache({ index: async () => index, load: () => new Promise<Object3D>((r) => (arrive = r)) }, vi.fn());
    const { presenter } = setup({ models });
    await vi.waitFor(() => expect(arrive).toBeDefined());
    presenter.dispose();
    arrive(scene);
    await presenter.ready;
    expect(cloned).not.toHaveBeenCalled();
    expect(presenter.info().fighters[0]).toBe("loading");
  });
});
