/**
 * The stage in 3D: one solid per platform, generated from the sim's own
 * platform rectangles (`StageDef.platforms`), so the surface a fighter stands on
 * is the surface the sim lands them on — no art to drift out of step.
 *
 * A main platform is a wall-sided block `HARD_PLATFORM_DEPTH` deep below its
 * top: exactly the solid the sim collides with, so a fighter that is pushed off
 * a wall, or stopped by an underside, is pushed off and stopped by what is drawn
 * (ruling R13). A soft platform is a thin slab: the sim gives it no body, only
 * a top surface to land on. Each is one mesh with vertex colours from the
 * stage's palette (`stagePaintFor`), so a whole stage is one draw call per
 * platform, and one more for a decorative underside where its theme has one
 * (Plan 6, Task 33) — Battlefield is five.
 *
 * Moving platforms are placed every frame with `platformCentreX`, the sim's own
 * function, rather than the 2D art's float sine, so they never disagree.
 */

import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from "three";

import { toFloat } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import type { Platform, StageDef } from "@/engine/types";
import { stagePaintFor } from "@/render/stageArt";
import { MAIN_DEPTH_Z } from "@/render/stageClip";

/** A main body is the sim's solid, as deep as the sim makes it (R13). */
export const MAIN_DEPTH = toFloat(HARD_PLATFORM_DEPTH);
/** How thick a soft platform is drawn. UNVERIFIED (cosmetic): the sim gives a soft platform no body. */
export const SOFT_THICKNESS = 1.2;
/** How far a solid platform reaches toward and away from the camera (`render/stageClip.ts`, where the overlay clips by it). */
export { MAIN_DEPTH_Z };
export const SOFT_DEPTH_Z = 18;
/**
 * The stage draws first and writes no depth (Plan 6, Task 33; ruling D11): its depth toward
 * the camera is decoration, the sim's world is the play plane, and nothing on that plane
 * outside the solid is ever hidden by it. In the side camera's perspective the front face
 * stands out past the wall the sim collides with, and it hid a fighter hugging the wall;
 * drawn first with no depth, the fighters, their shields and sparks go over it, and the
 * stage stays exactly as wide as its collision (R13). Each body is convex and drawn with
 * its back faces culled, so it needs no depth of its own; the underside, behind the play
 * plane, draws before the bodies.
 */
export const STAGE_RENDER_ORDER = -1;

export type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/** `c` darkened toward black by `k` (0 none, 1 black). */
function darken(c: Rgb, k: number): Rgb {
  return [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)];
}

/** The ledge lip's height down the front face (Plan 6, Task 33: `StagePaint.edge`). UNVERIFIED (cosmetic). */
export const LIP_HEIGHT = 0.7;

export interface PrismOptions {
  /** A band of the front face's top in this colour, `lipHeight` deep: the ledge lip (Plan 6, Task 33). */
  readonly lip?: Rgb;
  readonly lipHeight?: number;
  /** The walls' colour at their bottom edge, shading up to `side` at the top (Plan 6, Task 33). */
  readonly faceBottom?: Rgb;
}

type Corner = readonly [number, number, number];

/**
 * A tapered prism centred on x = 0: top face at y = 0 from −half to +half,
 * bottom face at y = −height from −half·taper to +half·taper, ±depthZ/2 deep.
 * Non-indexed so each face carries its own colours and flat normal. With
 * `opts`, the front face's top band is the lip, and the walls shade from
 * `side` at the top to `faceBottom` at the bottom (Plan 6, Task 33).
 */
export function prismGeometry(half: number, height: number, taper: number, depthZ: number, top: Rgb, side: Rgb, bottom: Rgb, opts: PrismOptions = {}): BufferGeometry {
  const z0 = -depthZ / 2;
  const z1 = depthZ / 2;
  const b = half * taper;
  const P = {
    tlf: [-half, 0, z1], trf: [half, 0, z1], tlb: [-half, 0, z0], trb: [half, 0, z0],
    blf: [-b, -height, z1], brf: [b, -height, z1], blb: [-b, -height, z0], brb: [b, -height, z0],
  } as const;
  const wall = (p: Corner): Rgb => (opts.faceBottom !== undefined && p[1] === -height ? opts.faceBottom : side);
  const flat = (c: Rgb) => (): Rgb => c;
  const quads: [Corner, Corner, Corner, Corner, (p: Corner) => Rgb][] = [[P.tlb, P.tlf, P.trf, P.trb, flat(top)]];
  if (opts.lip !== undefined) {
    // The front face split where the lip ends: the lip above, the shaded wall below.
    const k = Math.min(1, (opts.lipHeight ?? LIP_HEIGHT) / height);
    const Lf: Corner = [P.tlf[0] + (P.blf[0] - P.tlf[0]) * k, -height * k, z1];
    const Rf: Corner = [P.trf[0] + (P.brf[0] - P.trf[0]) * k, -height * k, z1];
    quads.push([P.tlf, Lf, Rf, P.trf, flat(opts.lip)], [Lf, P.blf, P.brf, Rf, wall]);
  } else {
    quads.push([P.tlf, P.blf, P.brf, P.trf, wall]);
  }
  quads.push(
    [P.trb, P.brb, P.blb, P.tlb, wall],
    [P.tlb, P.blb, P.blf, P.tlf, wall],
    [P.trf, P.brf, P.brb, P.trb, wall],
    [P.blf, P.blb, P.brb, P.brf, flat(bottom)],
  );
  const pos: number[] = [];
  const col: number[] = [];
  for (const [a, b2, c, d, colour] of quads) {
    for (const v of [a, b2, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      col.push(...colour(v));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

export interface Stage3D {
  readonly group: Group;
  /** Place moving platforms for sim frame `frame`. */
  update(frame: number): void;
  dispose(): void;
}

export function createStage3D(stage: StageDef): Stage3D {
  const paint = stagePaintFor(stage);
  const material = new MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  const group = new Group();
  group.name = `stage:${stage.id}`;
  const meshes: Mesh[] = [];
  // Only a moving platform is ever placed again, so the per-frame path walks just those.
  const movers: { mesh: Mesh; platform: Platform }[] = [];
  for (const platform of stage.platforms) {
    const half = toFloat(platform.halfWidth);
    const geometry = platform.soft
      ? prismGeometry(half, SOFT_THICKNESS, 1, SOFT_DEPTH_Z, rgb(paint.softEdge), rgb(paint.soft), rgb(paint.soft))
      : prismGeometry(half, MAIN_DEPTH, 1, MAIN_DEPTH_Z, rgb(paint.top), rgb(paint.face), rgb(paint.deep), {
          lip: rgb(paint.edge),
          lipHeight: LIP_HEIGHT,
          faceBottom: rgb(paint.deep),
        });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(toFloat(platform.x), toFloat(platform.y), 0);
    mesh.receiveShadow = true;
    mesh.renderOrder = STAGE_RENDER_ORDER;
    group.add(mesh);
    meshes.push(mesh);
    if (platform.motion) movers.push({ mesh, platform });
  }

  // The decorative tapered underside (Plan 6, Task 33), for the themes that taper below:
  // under the main body's bottom and wholly behind the play plane (z −18.5 to −0.5), so
  // nothing the sim does meets it, and a fighter under the stage is drawn in front of it.
  // Its walls go on from the body's deep colour to darker still. One draw call.
  const under = paint.underside;
  const main = stage.platforms.find((p) => !p.soft);
  if (under !== undefined && main !== undefined) {
    const deep = rgb(paint.deep);
    const darker = darken(deep, 0.45);
    const mesh = new Mesh(prismGeometry(toFloat(main.halfWidth), under.depth, under.taper, MAIN_DEPTH_Z / 2, deep, deep, darker, { faceBottom: darker }), material);
    mesh.name = "underside";
    mesh.position.set(toFloat(main.x), toFloat(main.y) - MAIN_DEPTH, -MAIN_DEPTH_Z / 4 - 0.5);
    mesh.renderOrder = STAGE_RENDER_ORDER - 1;
    group.add(mesh);
    meshes.push(mesh);
  }
  return {
    group,
    update(frame) {
      for (let i = 0; i < movers.length; i++) {
        const { mesh, platform } = movers[i];
        mesh.position.x = toFloat(platformCentreX(platform, frame));
      }
    },
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
