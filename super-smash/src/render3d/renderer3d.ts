/**
 * The 3D presenter: owns the WebGL canvas, the scene (stage, fighters, effects,
 * blob shadows, lights) and its camera, and paints one frame when the match
 * runner asks. The HUD and every 2D effect stay on the overlay canvas above it
 * (`render/renderer.ts` with `world3d`), framed by the same `Camera`, so the two
 * layers line up exactly (`camera3d.ts`).
 *
 * It never takes the match down: missing glbs become stand-ins (`models/`), a
 * lost WebGL context pauses painting until the browser restores it (the sim
 * keeps running), and `dispose()` frees every GPU resource it drew when the
 * match ends (`MatchRunner.dispose`).
 *
 * Frame cost (the R§4 budget, `budget.ts`): one draw call per stage platform,
 * one per glb primitive (stand-ins: one per hurt capsule), and one call per
 * batch, however many are up: one for all the sparks and bursts, one for all
 * the shields, one for all the blob shadows. `renderer3d.test.ts` holds four
 * fighters at `glb.mjs`'s caps with every effect live, fading or not, under
 * `MAX_DRAW_CALLS` and `MAX_TRIANGLES_PER_FRAME`. Shadow maps would draw every
 * fighter twice, so the shadows are discs. No bloom ("Decisions taken" 7), no
 * tone mapping, sRGB out.
 */

import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NoToneMapping,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Camera as ThreeCamera,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Texture,
  type ToneMapping,
} from "three";

import type { BakeTables } from "@/engine/acmd/bakeTables";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, FighterState, GameState, StageDef } from "@/engine/types";
import { VIEW_HEIGHT, VIEW_WIDTH, type Camera } from "@/render/camera";
import { interpolatePosition, type RenderState } from "@/render/renderer";
import { hitFlashAmount } from "@/render/vfx";
import { fighterPoser } from "./bake/bake";
import { applySideCamera, createSideCamera } from "./camera3d";
import { createFighter3D, type Fighter3D } from "./fighter3d";
import type { ModelCache } from "./models/loader";
import type { SkeletonFile } from "./skeleton/skeleton";
import { createStage3D } from "./stage3d";
import { createVfx3D, shieldLook, type ShieldLook } from "./vfx3d";

/** The part of `WebGLRenderer` the presenter uses — a fake in jsdom tests. */
export interface GLLike {
  readonly domElement: HTMLCanvasElement;
  readonly info: { readonly render: { readonly calls: number; readonly triangles: number } };
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle: boolean): void;
  setClearColor(colour: number, alpha: number): void;
  render(scene: Object3D, camera: ThreeCamera): void;
  dispose(): void;
  /** Set by the presenter (three's defaults are the same); optional, so a fake need not carry them. */
  toneMapping?: ToneMapping;
  outputColorSpace?: string;
}

export interface RenderInfo {
  readonly calls: number;
  readonly triangles: number;
  readonly lost: boolean;
  readonly buffer: { readonly width: number; readonly height: number };
  /** Per port: what that fighter is drawn as, or "loading" until its model (or stand-in) is in. */
  readonly fighters: readonly ("glb" | "standIn" | "loading")[];
}

export interface Presenter3D {
  /** Resolves when every fighter has a model (or a stand-in). */
  readonly ready: Promise<void>;
  /** `hidden[port]`: a move effect replaces that fighter this frame. */
  paint(rs: RenderState, camera: Camera, alpha: number, hidden: readonly boolean[]): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  info(): RenderInfo;
  /**
   * Frees everything it drew, once, and its listeners. The canvas's WebGL
   * context is left usable: the next match's presenter may draw on the same
   * canvas (React's development remount reuses it, Task 20).
   */
  dispose(): void;
}

export interface Renderer3DOptions {
  readonly canvas: HTMLCanvasElement;
  readonly stage: StageDef;
  readonly defs: readonly (FighterDef | null)[];
  readonly bake: BakeTables;
  readonly skeletons: Readonly<Record<string, SkeletonFile>>;
  readonly models: ModelCache;
  readonly makeGL?: (canvas: HTMLCanvasElement) => GLLike;
}

/** The game's 16:9 in its smallest whole steps: a buffer is `k` of each. */
const STEP_W = 16;
const STEP_H = 9;
/** 320×180: below this a buffer is not worth drawing. */
const MIN_STEPS = 20;
/** 1920×1080: the game's internal resolution and the R§4 budget's. */
const MAX_STEPS = VIEW_WIDTH / STEP_W;

/**
 * The drawing buffer for a canvas shown at `css` pixels on a `dpr` display: the
 * device pixels of the largest 16:9 box the canvas holds, capped at the game's
 * 1920×1080, and always exactly 16:9 (whole multiples of 16×9), because
 * `applySideCamera` frames 16:9 whatever buffer it draws into and the overlay
 * canvas is 16:9: a buffer of any other shape would stretch this layer against
 * it.
 */
export function bufferSizeFor(cssWidth: number, cssHeight: number, dpr: number): { width: number; height: number } {
  const fit = Math.min(cssWidth, (cssHeight * VIEW_WIDTH) / VIEW_HEIGHT) * Math.max(0.5, dpr || 1);
  // `|| MIN_STEPS`: a canvas with no size yet (or NaN) gets the smallest buffer, not a NaN one.
  const k = Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(fit / STEP_W) || MIN_STEPS));
  return { width: k * STEP_W, height: k * STEP_H };
}

function defaultGL(canvas: HTMLCanvasElement): GLLike {
  return new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
}

/** Cleared to nothing: the overlay's background shows where nothing is drawn. */
const CLEAR_COLOUR = 0x000000;
const CLEAR_ALPHA = 0;

/**
 * Light intensities (three's physically based units: a white face meets its
 * albedo at about π of light). The key light leads the fill so the toon ramp's
 * bands read; a face toward the camera gets (2.6 + 0.44 + 0.1) / π ≈ 1.0 × its
 * albedo. UNVERIFIED (by eye): the Task 19 review's measured values; polish
 * revisits them with screenshots.
 */
const LIGHTS = { hemisphere: 0.8, ambient: 0.1, sun: 2.6 } as const;

/**
 * The scene's three lights, as a match lights it. The animation lab's model
 * sheet (`app/anim/Lab3D.tsx`) builds its lights here too, so a clip is judged
 * under the light the game draws it in.
 */
export function createLights(): { readonly hemisphere: HemisphereLight; readonly ambient: AmbientLight; readonly sun: DirectionalLight } {
  const hemisphere = new HemisphereLight(0xffffff, 0x445066, LIGHTS.hemisphere);
  const ambient = new AmbientLight(0xffffff, LIGHTS.ambient);
  const sun = new DirectionalLight(0xffffff, LIGHTS.sun);
  sun.position.set(-40, 120, 160);
  return { hemisphere, ambient, sun };
}

/** A blob shadow's size against the fighter's `attributes.width`, across and in depth. UNVERIFIED (cosmetic): by eye. */
const SHADOW_ACROSS = 1.6;
const SHADOW_DEEP = 1.1;
/** How far a shadow floats over the ground it is cast on, so it never fights the platform's top. UNVERIFIED (cosmetic). */
const SHADOW_LIFT = 0.05;

/** A shield as drawn this frame: `shieldLook`'s, moved to where its fighter is drawn. One per port, refilled. */
interface DrawnShield {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  colour: string;
}

/** Something the GPU holds a copy of, which three frees on a "dispose" event. */
export interface Freeable {
  addEventListener(type: "dispose", listener: (event: { target: unknown }) => void): void;
  removeEventListener(type: "dispose", listener: (event: { target: unknown }) => void): void;
  dispose(): void;
}

/**
 * What three holds a GPU copy of for `scene`, and hangs a "dispose" listener on:
 * every geometry, material and texture (a skeleton's bone texture too), and
 * every instanced mesh (its instance buffers).
 */
export function drawnResources(scene: Object3D): Set<Freeable> {
  const out = new Set<Freeable>();
  const add = (r: object) => out.add(r as Freeable);
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      add(m);
      for (const v of Object.values(m as Material)) if ((v as Texture | null)?.isTexture === true) add(v as Texture);
    }
    if ((o as InstancedMesh).isInstancedMesh) add(o);
    const bones = (o as SkinnedMesh).isSkinnedMesh ? (o as SkinnedMesh).skeleton.boneTexture : null;
    if (bones !== null) add(bones);
  });
  return out;
}

function previousOf(previous: GameState | null, port: number): FighterState | undefined {
  if (previous === null) return undefined;
  for (let i = 0; i < previous.fighters.length; i++) if (previous.fighters[i].port === port) return previous.fighters[i];
  return undefined;
}

export function createRenderer3D(opts: Renderer3DOptions): Presenter3D {
  const gl = (opts.makeGL ?? defaultGL)(opts.canvas);
  gl.setClearColor(CLEAR_COLOUR, CLEAR_ALPHA);
  gl.toneMapping = NoToneMapping;
  gl.outputColorSpace = SRGBColorSpace;
  // The buffer is sized in device pixels already (`bufferSizeFor`).
  gl.setPixelRatio(1);
  let buffer = bufferSizeFor(VIEW_WIDTH, VIEW_HEIGHT, 1);
  gl.setSize(buffer.width, buffer.height, false);

  const scene = new Scene();
  // Whoever moves an object builds its matrices, once a frame (`paint`): three's
  // own pass would build every one of them again (158 for Marth alone, the
  // Task 17 review measured).
  scene.matrixWorldAutoUpdate = false;
  const camera = createSideCamera();
  // In the scene, `applySideCamera`'s update is its only one: three updates a camera again only if it has no parent.
  scene.add(camera);

  const { hemisphere, ambient, sun } = createLights();
  const stage = createStage3D(opts.stage);
  const vfx = createVfx3D();

  // Blob shadows: one instanced disc per grounded fighter, one draw call.
  const shadowGeometry = new CircleGeometry(1, 24);
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new MeshBasicMaterial({ color: new Color(0x000000), transparent: true, opacity: 0.35, depthWrite: false });
  const shadows = new InstancedMesh(shadowGeometry, shadowMaterial, Math.max(1, opts.defs.length));
  shadows.name = "shadows";
  shadows.count = 0;
  shadows.frustumCulled = false;
  shadows.instanceMatrix.setUsage(DynamicDrawUsage);

  /** Every layer but the fighters, whose matrices `paint` builds; each fighter builds its own (`Fighter3D.update`). */
  const fixed: Object3D[] = [hemisphere, ambient, sun, stage.group, shadows, vfx.group];
  scene.add(...fixed);

  const fighters: (Fighter3D | null)[] = opts.defs.map(() => null);
  const shields: (DrawnShield | null)[] = opts.defs.map(() => null);
  const drawnShields: DrawnShield[] = opts.defs.map(() => ({ x: 0, y: 0, radius: 0, alpha: 0, colour: "" }));
  let disposed = false;

  const ready = Promise.all(
    opts.defs.map(async (def, port) => {
      if (def === null) return;
      const skeleton = opts.skeletons[def.id];
      if (skeleton === undefined) throw new Error(`no skeleton for ${def.id}`);
      const model = await opts.models.get(def.id);
      // A model that arrives after the match ended is never built: there is nothing left to free it.
      if (disposed) return;
      const fighter = createFighter3D({ def, port, poser: fighterPoser(def, skeleton), bake: opts.bake, model });
      fighters[port] = fighter;
      scene.add(fighter.placement);
    }),
  ).then(() => undefined);

  let lost = false;
  const onLost = (e: Event) => {
    // Without preventDefault the browser never offers the context back.
    e.preventDefault();
    lost = true;
    // Every GPU copy went with the context. Tell three to forget each one now,
    // while its deletes are no-ops: on restore it starts afresh but leaves its
    // old records' listeners on everything, which would keep them alive and
    // fire at the dead context's objects at the next dispose ("object does not
    // belong to this context", measured in Chromium).
    for (const r of drawnResources(scene)) r.dispose();
  };
  const onRestored = () => {
    lost = false;
    // three's restore starts its background from its own default clear colour; this layer's is put back.
    gl.setClearColor(CLEAR_COLOUR, CLEAR_ALPHA);
    // three starts its GL state afresh on restore and uploads geometry and
    // textures again as it draws them; every material compiles again too.
    scene.traverse((o) => {
      const m = (o as Partial<Mesh>).material;
      if (m === undefined) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  };
  opts.canvas.addEventListener("webglcontextlost", onLost, false);
  opts.canvas.addEventListener("webglcontextrestored", onRestored, false);

  const m = new Matrix4();
  const flat = new Quaternion();
  const size = new Vector3();
  const at = new Vector3();

  return {
    ready,
    paint(rs, cam, alpha, hidden) {
      if (disposed || lost) return;
      const game = rs.current;
      // Moving platforms where the sim has them this frame, before anything is drawn (the 2D art draws `game.frame` too).
      stage.update(game.frame);
      applySideCamera(camera, cam);

      let shadowCount = 0;
      shields.fill(null);
      for (let i = 0; i < game.fighters.length; i++) {
        const f = game.fighters[i];
        const fighter = fighters[f.port] ?? null;
        const def = rs.fighters[f.port] ?? null;
        if (fighter === null || def === null) continue;
        const pos = interpolatePosition(previousOf(rs.previous, f.port), f, alpha);
        fighter.update({
          f,
          x: pos.x,
          y: pos.y,
          frame: game.frame,
          blends: rs.vfx.poseBlend,
          hitFlash: hitFlashAmount(rs.vfx, f.port),
          hidden: hidden[f.port] ?? false,
        });
        // The sim's bubble, centre and radius, carried to where its fighter is drawn between frames.
        const look: ShieldLook | null = shieldLook(f, def, rs.vfx.parryFlash[f.port] ?? 0);
        if (look !== null) {
          const s = drawnShields[f.port];
          s.x = look.x + (pos.x - toFloat(f.x));
          s.y = look.y + (pos.y - toFloat(f.y));
          s.radius = look.radius;
          s.alpha = look.alpha;
          s.colour = look.colour;
          shields[f.port] = s;
        }
        if (f.grounded && f.action !== "dead" && shadowCount < shadows.instanceMatrix.count) {
          const w = toFloat(def.attributes.width);
          m.compose(at.set(pos.x, pos.y + SHADOW_LIFT, 0), flat, size.set(w * SHADOW_ACROSS, 1, w * SHADOW_DEEP));
          shadows.setMatrixAt(shadowCount++, m);
        }
      }
      shadows.count = shadowCount;
      shadows.instanceMatrix.needsUpdate = true;
      vfx.update(rs.vfx, shields);
      for (let i = 0; i < fixed.length; i++) fixed[i].updateMatrixWorld();
      gl.render(scene, camera);
    },
    resize(cssWidth, cssHeight, dpr) {
      const next = bufferSizeFor(cssWidth, cssHeight, dpr);
      if (next.width === buffer.width && next.height === buffer.height) return;
      buffer = next;
      gl.setSize(buffer.width, buffer.height, false);
    },
    info() {
      return {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        lost,
        buffer,
        fighters: fighters.map((f) => f?.kind ?? "loading"),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      opts.canvas.removeEventListener("webglcontextlost", onLost, false);
      opts.canvas.removeEventListener("webglcontextrestored", onRestored, false);
      // Everything drawn, gathered while it is still in the scene.
      const drawn = drawnResources(scene);
      // Every layer leaves the scene before anything in it is freed: a freed layer never stays attached.
      for (const f of fighters) if (f !== null) scene.remove(f.placement);
      scene.remove(...fixed);
      scene.clear();
      // Each layer frees what it made...
      const left = new Set(drawn);
      const freed = (e: { target: unknown }) => left.delete(e.target as Freeable);
      for (const r of drawn) r.addEventListener("dispose", freed);
      for (const f of fighters) f?.dispose();
      stage.dispose();
      vfx.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      shadows.dispose();
      for (const r of drawn) r.removeEventListener("dispose", freed);
      // ...and the rest is shared — the model cache's geometry and textures, the
      // toon ramp — but its GPU copy (and the listener three hung on it) is this
      // renderer's. A "dispose" in three frees exactly that, so the cache keeps
      // its data for the next match's renderer, which must upload it again anyway.
      for (const r of left) r.dispose();
      // Not `forceContextLoss()`: that loses the canvas's context for good, and
      // the next presenter on this canvas could never draw (Task 19 review).
      gl.dispose();
    },
  };
}
